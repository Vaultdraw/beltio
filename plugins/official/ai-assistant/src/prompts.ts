/** The instructions for each task. Short on purpose: the user sees exactly what is sent. */
export type Task = "ask" | "describe" | "diagram" | "summarise";

export const TASK_TITLES: Record<Task, string> = {
  ask: "Ask",
  describe: "Describe the selection",
  diagram: "Generate a diagram",
  summarise: "Summarise",
};

const BASE =
  "You help someone who works in a drawing app (Excalidraw style). Answer briefly and plainly. No preamble.";

export const SYSTEM: Record<Task, string> = {
  ask: `${BASE} The drawing is given as a list of its elements with their text and positions.`,
  describe: `${BASE} Describe what the given part of a drawing shows, in a few sentences, in plain words. The part is given as a list of elements with their text and positions.`,
  diagram: `${BASE} Turn the request into a Mermaid diagram. Reply with ONE fenced code block marked mermaid and nothing else. Use only flowchart, sequence, class, state or ER syntax. Keep node labels short.`,
  summarise: `${BASE} Summarise the text. Use a short paragraph, then at most five bullet points for the key facts. Do not add facts that are not in the text.`,
};

/** The user message for a task: the request, then the context when there is one. */
export function userMessage(
  task: Task,
  request: string,
  context: string,
): string {
  const ask = request.trim();
  if (task === "diagram") {
    return ask;
  }
  const head =
    task === "describe"
      ? "Describe this."
      : task === "summarise"
      ? "Summarise this."
      : ask;
  return context ? `${head}\n\n---\n${context}` : head;
}
