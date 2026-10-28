export interface BubbleColorPreset {
  id: string;
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

export const BUBBLE_COLOR_PRESETS: BubbleColorPreset[] = [
  { id: "paper", label: "Paper", bgColor: "bg-white", textColor: "text-gray-900", borderColor: "border-gray-300" },
  { id: "slate", label: "Slate", bgColor: "bg-gray-600", textColor: "text-white", borderColor: "border-gray-700" },
  { id: "sky", label: "Sky", bgColor: "bg-sky-400", textColor: "text-white", borderColor: "border-sky-600" },
  { id: "blue", label: "Blue", bgColor: "bg-blue-500", textColor: "text-white", borderColor: "border-blue-600" },
  { id: "purple", label: "Purple", bgColor: "bg-purple-500", textColor: "text-white", borderColor: "border-purple-600" },
  { id: "pink", label: "Pink", bgColor: "bg-pink-500", textColor: "text-white", borderColor: "border-pink-600" },
  { id: "red", label: "Red", bgColor: "bg-red-500", textColor: "text-white", borderColor: "border-red-600" },
  { id: "amber", label: "Amber", bgColor: "bg-amber-600", textColor: "text-white", borderColor: "border-amber-700" },
  { id: "yellow", label: "Yellow", bgColor: "bg-yellow-500", textColor: "text-gray-900", borderColor: "border-yellow-600" },
  { id: "green", label: "Green", bgColor: "bg-green-500", textColor: "text-white", borderColor: "border-green-600" },
  { id: "teal", label: "Teal", bgColor: "bg-teal-500", textColor: "text-white", borderColor: "border-teal-600" },
  { id: "orange", label: "Orange", bgColor: "bg-orange-500", textColor: "text-white", borderColor: "border-orange-600" },
];

// Returns the user's override for a personality, or null to use its default color.
export function bubbleColorFor(
  overrides: Record<string, string> | undefined | null,
  personalityId: string
): BubbleColorPreset | null {
  const id = overrides?.[personalityId];
  return BUBBLE_COLOR_PRESETS.find((p) => p.id === id) || null;
}
