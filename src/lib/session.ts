
export type StudyTool = "chat" | "flashcards" | "quiz" | "summarizer";


export async function startToolSession(_uid: string, _tool: StudyTool): Promise<void> {
  // Time-spent tracking disabled
  return;
}

export async function endToolSession(_uid: string, _tool: StudyTool): Promise<void> {
  // Time-spent tracking disabled
  return;
}
