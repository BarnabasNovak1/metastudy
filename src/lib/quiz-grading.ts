import { API_BASE, getAuthHeaders } from "@/lib/api-utils";

export interface GradableQuestion {
  question: string;
  question_type?: string;
  options?: unknown;
  correct_answer?: string;
  reference_answer?: string;
}

export const isShortAnswerQuestion = (question: GradableQuestion) =>
  question.question_type === "short_answer" ||
  !question.options || Object.keys(question.options).length === 0;

export const getReferenceAnswer = (question: GradableQuestion) =>
  question.reference_answer?.trim() || question.correct_answer?.trim() || "";

export interface GradedAnswer {
  score: number;
  feedback: string;
  expectedAnswer: string;
}

// Both the library and feed use this mapping so mixed quizzes preserve order
// and multiple-choice answers are never sent to the short-answer grader.
export async function gradeQuizAnswers(
  title: string,
  questions: GradableQuestion[],
  answers: Record<number, string | number>,
  gradeMultipleChoice: (index: number) => GradedAnswer,
) {
  const shortQuestions = questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => isShortAnswerQuestion(question));
  let shortItems: GradedAnswer[] = [];
  if (shortQuestions.length) {
    const response = await fetch(`${API_BASE}/quiz/grade-short-answers`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        title,
        questions: shortQuestions.map(({ question }) => question.question),
        answers: shortQuestions.map(({ index }) => String(answers[index] ?? "")),
        referenceAnswers: shortQuestions.map(({ question }) => getReferenceAnswer(question)),
      }),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "Failed to grade answers. Please try again.");
    if (!Array.isArray(data.items) || data.items.length !== shortQuestions.length ||
        data.items.some((item: GradedAnswer) => !item || typeof item.score !== "number" ||
          !Number.isFinite(item.score) || item.score < 0 || item.score > 100 ||
          typeof item.feedback !== "string" || typeof item.expectedAnswer !== "string")) {
      throw new Error("Grading returned incomplete results. Please try again.");
    }
    shortItems = data.items;
  }
  let shortIndex = 0;
  const items = questions.map((question, index) =>
    isShortAnswerQuestion(question) ? shortItems[shortIndex++] : gradeMultipleChoice(index),
  );
  return {
    items,
    overall: Math.round(items.reduce((sum, item) => sum + item.score, 0) / Math.max(1, items.length)),
  };
}
