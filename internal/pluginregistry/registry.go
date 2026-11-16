// Package pluginregistry observes registrations without executing Helm actions.
package pluginregistry

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	pluginapi "github.com/modelsphere/console/api/plugin/v1alpha1"
	"helm.sh/helm/v3/pkg/release"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/tools/cache"
	"k8s.io/client-go/util/workqueue"
)

type ReleaseReader func(context.Context, string, string) (*release.Release, error)

// Entry is an immutable registration snapshot derived from an installed Chart.
type Entry struct {
	Plugin pluginapi.Plugin
	Files  map[string][]byte
	Routes []Route
}

// Registry owns snapshots; callers must not mutate returned entries.
type Registry struct {
	client  dynamic.Interface
	read    ReleaseReader
	log     *slog.Logger
	mu      sync.RWMutex
	entries map[string]*Entry
	ready   atomic.Bool
}

func (r *Registry) Ready() bool { return r.ready.Load() }

func New(client dynamic.Interface, read ReleaseReader, log *slog.Logger) *Registry {
	return &Registry{client: client, read: read, log: log, entries: map[string]*Entry{}}
}

func (r *Registry) Entries() []*Entry {
	r.mu.RLock()
	defer r.mu.RUnlock()
	entries := make([]*Entry, 0, len(r.entries))
	for _, entry := range r.entries {
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Plugin.Name < entries[j].Plugin.Name })
	return entries
}

// Run retries failed reads and relists after watch loss; no Helm action is run.
func (r *Registry) Run(ctx context.Context) {
	factory := dynamicinformer.NewDynamicSharedInformerFactory(r.client, 30*time.Second)
	informer := factory.ForResource(pluginapi.Resource).Informer()
	queue := workqueue.NewTypedRateLimitingQueue(workqueue.DefaultTypedControllerRateLimiter[string]())
	defer queue.ShutDown()
	enqueue := func(obj any) {
		key, err := cache.DeletionHandlingMetaNamespaceKeyFunc(obj)
		if err == nil {
			queue.Add(key)
		}
	}
	if _, err := informer.AddEventHandler(cache.ResourceEventHandlerFuncs{AddFunc: enqueue, UpdateFunc: func(_, obj any) { enqueue(obj) }, DeleteFunc: enqueue}); err != nil {
		r.log.Error("watch plugin registrations", "error", err)
		return
	}
	factory.Start(ctx.Done())
	if !cache.WaitForCacheSync(ctx.Done(), informer.HasSynced) {
		return
	}
	for _, key := range informer.GetStore().ListKeys() {
		if err := r.reconcile(ctx, key, informer.GetStore()); err != nil {
			r.log.Error("read initial plugin registration", "plugin", key, "error", err)
		}
	}
	r.ready.Store(true)
	go func() { <-ctx.Done(); queue.ShutDown() }()
	for {
		key, shutdown := queue.Get()
		if shutdown {
			return
		}
		err := r.reconcile(ctx, key, informer.GetStore())
		if err != nil {
			r.log.Error("observe plugin registration", "plugin", key, "error", err)
			queue.AddRateLimited(key)
		} else {
			queue.Forget(key)
		}
		queue.Done(key)
	}
}

func (r *Registry) reconcile(ctx context.Context, key string, store cache.Store) error {
	obj, exists, err := store.GetByKey(key)
	if err != nil {
		return err
	}
	if !exists {
		r.remove(key)
		return nil
	}
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(obj)
	if err != nil {
		return err
	}
	var plugin pluginapi.Plugin
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(raw, &plugin); err != nil {
		return err
	}
	if !plugin.Spec.Enabled || !plugin.DeletionTimestamp.IsZero() {
		r.remove(key)
		return nil
	}
	entry, err := r.load(ctx, &plugin)
	if err != nil {
		r.remove(key)
		return r.report(ctx, &plugin, nil, err)
	}
	r.mu.Lock()
	r.entries[key] = entry
	r.mu.Unlock()
	return r.report(ctx, &plugin, entry, nil)
}

func (r *Registry) remove(key string) { r.mu.Lock(); delete(r.entries, key); r.mu.Unlock() }

func (r *Registry) report(ctx context.Context, plugin *pluginapi.Plugin, entry *Entry, cause error) error {
	status := plugin.Status
	status.ObservedGeneration = plugin.Generation
	status.Phase = pluginapi.PluginPhaseDegraded
	if cause != nil {
		status.Message = cause.Error()
		status.FrontendStatus = &pluginapi.FrontendStatus{Distributed: false}
	} else {
		status = entry.Plugin.Status
	}
	// Every Console replica maintains its own files; status is diagnostic only.
	if plugin.Status.ObservedGeneration == status.ObservedGeneration && plugin.Status.Phase == status.Phase && plugin.Status.Message == status.Message && plugin.Status.ReleaseVersion == status.ReleaseVersion {
		return cause
	}
	raw, err := runtime.DefaultUnstructuredConverter.ToUnstructured(plugin)
	if err != nil {
		return err
	}
	converted, err := runtime.DefaultUnstructuredConverter.ToUnstructured(&status)
	if err != nil {
		return err
	}
	raw["status"] = converted
	_, err = r.client.Resource(pluginapi.Resource).UpdateStatus(ctx, &unstructured.Unstructured{Object: raw}, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("write plugin status: %w", err)
	}
	return cause
}
