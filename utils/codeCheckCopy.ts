// The fixed disclaimer under every Code Check result. It is a constant, not a
// model field: the model used to write its own disclaimer, and a model can
// soften one. validate-code-check-honesty pins the exact string. It ends with
// the standing line every code result surface carries
// (utils/codeAckCore CODE_RESULT_NOTE; __tests__/guards/code-ack.test.ts pins
// the ending on all of them).
export const CODE_CHECK_DISCLAIMER =
  'AI guidance from model recall, not a code lookup and not legal advice. Not a substitute for the adopted code. Confirm with your building department.';
