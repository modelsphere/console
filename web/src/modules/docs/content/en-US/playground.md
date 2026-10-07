# Playground

The Playground lets you talk to deployed models in the browser, to check their answers. Requests go through the console to the inference gateway; the gateway key stays on the server and never reaches the browser.

## Chat

Open [Chat](/playground):

1. Pick a model at the top. The list is the deployments in [Inference Services](/inferences), ready ones first, shown as `release · served name`; one that cannot be called yet is greyed out with why. If it says no model is deployed yet, [deploy](/help/docs/deploy) one; it appears here once ready.
2. Type below: **Enter sends, Shift+Enter adds a line**. **Stop** ends a generation early.
3. Under every answer: time to first token (TTFT), duration, input/output tokens, tok/s and cache hit rate.

Working with messages:

- Edit or delete any message, or **regenerate** the last answer.
- Switch the composer to "Assistant": **Add** only appends the message, **Send** appends it and asks the model to continue. Useful for building few-shot examples.
- Reasoning models' thinking is shown in a collapsible block.

A conversation keeps one session ID, so the gateway pins it to one inference instance and the prefix cache keeps hitting. **New chat** starts a new session.

## Parameters

**Parameters** opens the panel:

- **System prompt**: sent as the system message.
- **Max output tokens**, and under "More" temperature, top_p, seed, stop sequences and penalties.
- Empty parameters are not sent; the engine uses its own defaults.
- **Reset** restores the defaults and keeps the system prompt.

## View code

**View code** gives the request for the current model, parameters and conversation as cURL, Python or Node.js. Set the `MODELSPHERE_API_KEY` environment variable to an API key first; see [Calling the API](/help/docs/api).
