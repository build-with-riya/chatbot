async function loadConfig() {
  const response = await fetch('config.json');
  return response.json();
}

// Store chat history (messages with role + content)
let chatHistory = [];

const enc = new TextEncoder();
const dec = new TextDecoder();

// 🔐 Derive AES-GCM crypto key from password string
async function getKey(password) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password),
    { name: "PBKDF2" }, false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("fixed-salt"), // ⚠️ replace with random salt in real apps
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// 🔒 Encrypt text with password
async function encryptText(plainText, password) {
  const key = await getKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plainText)
  );
  const buffer = new Uint8Array(iv.length + encrypted.byteLength);
  buffer.set(iv, 0);
  buffer.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...buffer)); // Base64
}

// 🔓 Decrypt text with password
async function decryptText(cipherBase64, password) {
  const data = Uint8Array.from(atob(cipherBase64), c => c.charCodeAt(0));
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const key = await getKey(password);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return dec.decode(decrypted);
}

function createBubble(text, sender = "assistant") {
  const wrapper = document.createElement("div");
  wrapper.className = `flex ${sender === "user" ? "justify-end" : "justify-start"}`;

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${sender}`;

  if (sender === "assistant") {
    bubble.innerHTML = marked.parse(text);   // ✅ render markdown
  } else {
    bubble.textContent = text;
  }

  wrapper.appendChild(bubble);
  return wrapper;
}

function createThinkingBubble() {
  const div = document.createElement("div");
  div.className = "flex justify-start items-center space-x-2 text-gray-500 thinking";
  div.innerHTML = '<div class="spinner"></div><span>सोच रहा हूँ...</span>';
  return div;
}
async function sendMessage(message, config) {
  const chatWindow = document.getElementById("chat-window");
  chatWindow.appendChild(createBubble(message, "user"));
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // ➕ Add user message to history
  chatHistory.push({ role: "user", content: message });

  const thinkingBubble = createThinkingBubble();
  chatWindow.appendChild(thinkingBubble);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  try {
    // Keep only last 10 messages (plus system prompt)
    const recentHistory = chatHistory.slice(-10);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api_k}`
      },
      body: JSON.stringify({
        model: "gpt-5-mini-2025-08-07",
        input: [
          {
            role: "system",
            content: `You are the AI Support Assistant by ${config.org}.
- Always answer briefly
- Use Markdown for formatting
- Prefer bold or bullet points or numbered lists only if returning steps or lists in responses
- Be professional, avoid long paragraphs
- Always Answer in Hindi, उत्तर हिंदी में दें `
          },
          ...recentHistory
        ],
        max_output_tokens: 500,
        reasoning: { effort: "minimal" }
      })
    });

    const data = await response.json();
    chatWindow.removeChild(thinkingBubble);

    if (data.error) {
      chatWindow.appendChild(createBubble("माफ़ कीजिए, अभी जवाब नहीं ला पाए। कृपया बाद में कोशिश करें।", "assistant"));
    } else {
      const messageObj = data.output.find(o => o.type === "message");
      const assistantText = messageObj?.content?.map(c => c.text).join("\n") || "माफ़ कीजिए, अभी जवाब नहीं ला पाए। कृपया बाद में कोशिश करें।";
      chatWindow.appendChild(createBubble(assistantText, "assistant"));

      // ➕ Add assistant message to history
      chatHistory.push({ role: "assistant", content: assistantText });
    }
    chatWindow.scrollTop = chatWindow.scrollHeight;
  } catch (err) {
    chatWindow.removeChild(thinkingBubble);
    chatWindow.appendChild(createBubble("माफ़ कीजिए, अभी जवाब नहीं ला पाए। कृपया बाद में कोशिश करें।", "assistant"));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const config = await loadConfig();
  api_k = await decryptText(config.k, config.temp)

  const chatWindow = document.getElementById("chat-window");
  const welcomeMsg = `नमस्ते, मैं ${config.org} AI, आपका AI सहायक 👋\n\nबताइए मैं आपकी कैसे मदद कर सकता हूँ।`;
  chatWindow.appendChild(createBubble(welcomeMsg, "assistant"));

  // ➕ Add welcome assistant message to history
  chatHistory.push({ role: "assistant", content: welcomeMsg });

  const suggestionsDiv = document.getElementById("suggestions");
  config.suggestions.forEach(s => {
    const suggestion = document.createElement("div");
    suggestion.textContent = s;
    suggestion.className = "suggestion";
    suggestion.addEventListener("click", () => sendMessage(s, config));
    suggestionsDiv.appendChild(suggestion);
  });

  const sendBtn = document.getElementById("send-btn");
  const userInput = document.getElementById("user-input");

  sendBtn.addEventListener("click", () => {
    if (userInput.value.trim()) {
      sendMessage(userInput.value, config);
      userInput.value = "";
    }
  });

  userInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && userInput.value.trim()) {
      sendMessage(userInput.value, config);
      userInput.value = "";
    }
  });
});
