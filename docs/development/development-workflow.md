# Development workflow

From an issue to a merged pull request. Maintainers branch in `modelsphere/console` directly; everyone else works in a fork.

```
fork / branch ──▶ sync with main ──▶ commit ──▶ push ──▶ open PR ──▶ review ──▶ merged into main
                        ▲                                              │
                        └──────────── rebase, push again ◀─────────────┘
```

## 1. Get the code

**Maintainers** (write access):

```sh
git clone git@github.com:modelsphere/console.git
cd console
```

**Contributors** — fork on GitHub (`Fork` on <https://github.com/modelsphere/console>), then:

```sh
export user=<your GitHub user>
git clone git@github.com:$user/console.git
cd console
git remote add upstream https://github.com/modelsphere/console.git
git remote set-url --push upstream no_push       # never push to upstream by accident
git remote -v                                     # origin = your fork, upstream = modelsphere
```

Below, `upstream` means `modelsphere/console` — for maintainers that is `origin`.

## 2. Branch from an up-to-date main

```sh
git fetch upstream
git switch -c fix/compare-drops-column upstream/main
```

Branch names: `<type>/<short-topic>`, the type matching the commit types below — `feat/api-key-expiry`, `fix/metrics-service`, `docs/readme-rewrite`, `ci/publish-ghcr`. One branch per issue or PR.

Several branches at once? Use worktrees instead of stashing:

```sh
git worktree add ../console-wt/api-key-expiry -b feat/api-key-expiry upstream/main
```

## 3. Write the code

- Conventions: [coding-conventions.md](coding-conventions.md); running it: [local-development.md](local-development.md).
- Tests go in the same branch as the change.
- Before pushing, the checks CI runs:

  ```sh
  test -z "$(gofmt -l .)" && go vet ./... && go test ./...
  (cd web && npm run typecheck && npm test && npm run build)   # if web/ changed
  helm lint --strict helm/console                              # if the chart changed
  ```

## 4. Commit

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <what it does, imperative, lower case, no period>

<why: the problem, and why this is the fix — wrapped prose or a list>

Fixes #123
```

| type | for |
|---|---|
| `feat` | a new capability |
| `fix` | a bug fix |
| `docs` | docs only |
| `refactor` | code change with no behaviour change |
| `test` | tests only |
| `ci` | `.github/`, build and publish scripts |
| `chore` | everything else: dependency bumps, version bumps, copies |
| `perf` | faster or lighter, same behaviour |

Scopes follow the code: `iam`, `server`, `config`, `gateway`, `router`, `playground`, `swiss`, `shell`, `web`, `helm`, `install`. Breaking change: `feat(config)!: …` plus a `BREAKING CHANGE:` footer saying what operators must do.

From the history:

```
feat(iam): allow keeping the current password, with a warning
fix(helm): metrics on a ClusterIP Service of their own
refactor(router): /v1 and API keys are the router's, and usage is a metric
ci: publish the console image and chart to GHCR, as swiss does
```

Each commit should build and pass tests on its own. Fold "fix typo" and "address review" commits into the commit they fix before merge (`git commit --fixup <sha>` then `git rebase -i --autosquash`).

## 5. Keep in sync

Rebase on `main`, do not merge `main` into your branch:

```sh
git fetch upstream
git rebase upstream/main
# conflicts: fix, git add, git rebase --continue
```

## 6. Push

```sh
git push -u origin fix/compare-drops-column
git push --force-with-lease                       # after a rebase; never plain --force
```

## 7. Open the pull request

- `gh pr create --base main --repo modelsphere/console`, or `Compare & pull request` on GitHub.
- Title: the Conventional Commit line of the change.
- Body: the [PR template](../../.github/PULL_REQUEST_TEMPLATE.md), filled in.
- Not ready yet: open it as a **draft**.

What happens next is in [pull-requests.md](pull-requests.md).

## 8. After the merge

```sh
git switch main && git pull upstream main
git branch -d fix/compare-drops-column
git push origin --delete fix/compare-drops-column   # if GitHub did not delete it
```

## Releases

Console is released from `main`; there are no release branches.

```
merged to main ──▶ CI publishes <appVersion>-git<sha7> ──▶ hack/bump.sh patch --tag ──▶ push the tag ──▶ CI publishes <X.Y.Z> + latest
```

- `hack/bump.sh` moves `helm/console/Chart.yaml` and `internal/version` together; a test fails if they disagree.
- Only maintainers tag. A tag must equal the chart's `appVersion`, or CI refuses it.
