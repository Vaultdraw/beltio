# AI assistant

Ask a model you choose about your drawing, with your own key. Off until you turn it on in Settings, Plugins.

| Command | What it does |
| --- | --- |
| AI: Ask about this drawing | Opens the panel with the question box |
| AI: Describe the selection | Describes the selected shapes (or the drawing) |
| AI: Generate a diagram from text | Writes Mermaid, then draws it as shapes in one undo step |
| AI: Summarise this note | Summarises the selected text, or all text in the drawing |
| AI: Stop the answer | Cancels the running request |
| AI: Set API key, Remove API key | Saves or removes the key |

Providers: Anthropic, OpenAI (or any OpenAI-style address), Ollama. Choose provider, model, address and timeout in Settings, Plugins, AI assistant.

- The panel can show exactly what is sent ("Show what is sent").
- The key is kept in a protected file in the app's state folder, outside `config.toml` and your vault. It is not encrypted, and nothing can read it back.
- Offline mode stops every request except one to this computer (a local Ollama).
- No Vaultdraw server is involved: requests go straight from the app to the provider.
