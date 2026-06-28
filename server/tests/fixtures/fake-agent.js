import process from "node:process";

const mode = process.argv[2] ?? "json-success";

if (mode === "json-success") {
  let prompt = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    prompt += chunk;
  });
  process.stdin.on("end", () => {
    console.log(JSON.stringify({ type: "status", message: "started" }));
    console.log(JSON.stringify({ type: "text", text: `echo:${prompt.trim()}` }));
    console.error("fake stderr");
    console.log(JSON.stringify({ type: "usage", input_tokens: 1, output_tokens: 2 }));
    process.exit(0);
  });
} else if (mode === "json-wait") {
  console.log(JSON.stringify({ type: "status", message: "ready" }));
  process.stdin.resume();
  setInterval(() => undefined, 1000);
} else if (mode === "json-error-zero") {
  console.log(JSON.stringify({ type: "error", message: "subscription missing", code: "InvalidSubscription" }));
  process.exit(0);
} else if (mode === "json-stdin-close") {
  process.stdin.resume();
  process.stdin.on("end", () => {
    console.log(JSON.stringify({ type: "text", text: "stdin closed" }));
    process.exit(0);
  });
} else {
  console.error(`Unknown fake-agent mode: ${mode}`);
  process.exit(2);
}
