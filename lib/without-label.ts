// The one test for "this value means without": "No", "None", "Without
// headrest", "No RAL colour", "Not required". Shared by the tick box (which
// value an unticked box stands for) and the optional RAL option (which value
// leaving its box unticked picks), so the two can never read a label
// differently. Its own file because both of those import it and selection
// logic must not import the RAL helpers that import it back.
const WITHOUT_LABEL = /^\s*(no|none|without|not)\b/i

export function isWithoutLabel(label: string): boolean {
  return WITHOUT_LABEL.test(label)
}
