// Presets describe API protocols, not a promise that every offered model supports images.
export const PROVIDERS = [
  { id: 'ollama', name: 'Ollama', local: true, protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', customUrl: true, keyRequired: false, docs: 'https://docs.ollama.com/capabilities/vision' },
  { id: 'openai', name: 'OpenAI', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', docs: 'https://platform.openai.com/docs/guides/images-vision' },
  { id: 'anthropic', name: 'Anthropic / Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', docs: 'https://platform.claude.com/docs/en/build-with-claude/vision' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', docs: 'https://ai.google.dev/gemini-api/docs/openai' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', docs: 'https://openrouter.ai/docs/guides/overview/multimodal/images' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', docs: 'https://docs.mistral.ai/capabilities/vision' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', docs: 'https://console.groq.com/docs/vision' },
  { id: 'xai', name: 'xAI / Grok', baseUrl: 'https://api.x.ai/v1', docs: 'https://docs.x.ai/developers/model-capabilities/images/understanding' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', docs: 'https://docs.together.ai/docs/vision-overview' },
  { id: 'fireworks', name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', docs: 'https://docs.fireworks.ai/guides/querying-vision-language-models' },
  { id: 'compatible', name: 'OpenAI-kompatibel · Cloud', baseUrl: '', customUrl: true, docs: 'https://platform.openai.com/docs/api-reference/chat/create' },
  { id: 'lmstudio', name: 'LM Studio', local: true, baseUrl: 'http://127.0.0.1:1234/v1', customUrl: true, keyRequired: false, docs: 'https://lmstudio.ai/docs/developer/openai-compat' },
  { id: 'llamacpp', name: 'llama.cpp', local: true, baseUrl: 'http://127.0.0.1:8080/v1', customUrl: true, keyRequired: false, docs: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md' },
  { id: 'localai', name: 'LocalAI', local: true, baseUrl: 'http://127.0.0.1:8080/v1', customUrl: true, keyRequired: false, docs: 'https://localai.io/features/gpt-vision/' },
  { id: 'vllm', name: 'vLLM', local: true, baseUrl: 'http://127.0.0.1:8000/v1', customUrl: true, keyRequired: false, docs: 'https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/' },
  { id: 'localcompatible', name: 'OpenAI-kompatibel · lokal', local: true, baseUrl: 'http://127.0.0.1:8080/v1', customUrl: true, keyRequired: false, docs: 'https://platform.openai.com/docs/api-reference/chat/create' },
].map(item => Object.freeze({ local: false, protocol: 'chat', customUrl: false, keyRequired: true, ...item }));
export const providerInfo = id => PROVIDERS.find(item => item.id === id);
export const isLocalProvider = id => providerInfo(id)?.local === true;
export const providerLabel = id => providerInfo(id)?.name || id;
