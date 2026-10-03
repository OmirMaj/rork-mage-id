// GENERATED — do not edit; run bun run scripts/gen-skill-quiz-key.ts
//
// The answer key the skill-certificate-award function grades with. Rendered
// from utils/learn/quizBank.ts (QUIZ_BANKS) and utils/learn/topics.ts
// (SKILL_TOPICS, PASS_PCT); scripts/validate-skill-quiz-bank.ts fails the build
// when this file and the bank disagree. A pass is integer math:
// correct * 100 >= SKILL_PASS_PCT * total.

export interface SkillQuizKeyTopic {
  readonly version: number;
  readonly label: string;
  readonly certificateTitle: string;
  /** question id → the correct choice id */
  readonly answers: Readonly<Record<string, string>>;
  readonly total: number;
}

export interface SkillQuizKey {
  readonly PASS_PCT: number;
  readonly TOPICS: Readonly<Record<string, SkillQuizKeyTopic>>;
}

export const SKILL_PASS_PCT = 80;

export const SKILL_QUIZ_KEY: SkillQuizKey = {
  PASS_PCT: SKILL_PASS_PCT,
  TOPICS: {
    "ask-your-plans": {
      version: 1,
      label: "Ask your plans",
      certificateTitle: "MAGE ID skills: Ask your plans",
      answers: {
        "q1": "b",
        "q2": "a",
        "q3": "c",
        "q4": "b",
        "q5": "a",
      },
      total: 5,
    },
    "change-order-draft": {
      version: 1,
      label: "Change orders",
      certificateTitle: "MAGE ID skills: Change orders",
      answers: {
        "q1": "b",
        "q2": "a",
        "q3": "c",
        "q4": "a",
        "q5": "c",
      },
      total: 5,
    },
    "closeout-binder": {
      version: 1,
      label: "Closeout binders",
      certificateTitle: "MAGE ID skills: Closeout binders",
      answers: {
        "q1": "c",
        "q2": "a",
        "q3": "b",
        "q4": "b",
        "q5": "a",
      },
      total: 5,
    },
    "construction-ai-ask": {
      version: 1,
      label: "Construction AI",
      certificateTitle: "MAGE ID skills: Construction AI",
      answers: {
        "q1": "c",
        "q2": "b",
        "q3": "a",
        "q4": "b",
        "q5": "c",
      },
      total: 5,
    },
    "contract-from-estimate": {
      version: 1,
      label: "Contracts",
      certificateTitle: "MAGE ID skills: Contracts",
      answers: {
        "q1": "b",
        "q2": "a",
        "q3": "c",
        "q4": "c",
        "q5": "b",
      },
      total: 5,
    },
    "daily-report-voice": {
      version: 2,
      label: "Daily reports by voice",
      certificateTitle: "MAGE ID skills: Daily reports by voice",
      answers: {
        "q1": "b",
        "q2": "a",
        "q3": "c",
        "q4": "a",
        "q5": "b",
      },
      total: 5,
    },
    "estimate-first": {
      version: 1,
      label: "Estimates",
      certificateTitle: "MAGE ID skills: Estimates",
      answers: {
        "q1": "b",
        "q2": "a",
        "q3": "c",
        "q4": "b",
        "q5": "c",
      },
      total: 5,
    },
    "field-ticket-log": {
      version: 1,
      label: "Field tickets",
      certificateTitle: "MAGE ID skills: Field tickets",
      answers: {
        "q1": "b",
        "q2": "a",
        "q3": "c",
        "q4": "b",
        "q5": "a",
      },
      total: 5,
    },
    "invoice-to-self": {
      version: 1,
      label: "Invoicing",
      certificateTitle: "MAGE ID skills: Invoicing",
      answers: {
        "q1": "b",
        "q2": "a",
        "q3": "c",
        "q4": "b",
        "q5": "a",
      },
      total: 5,
    },
    "pay-app-period": {
      version: 1,
      label: "Pay applications",
      certificateTitle: "MAGE ID skills: Pay applications",
      answers: {
        "q1": "b",
        "q2": "a",
        "q3": "c",
        "q4": "a",
        "q5": "b",
      },
      total: 5,
    },
    "punch-list-close": {
      version: 1,
      label: "Punch lists",
      certificateTitle: "MAGE ID skills: Punch lists",
      answers: {
        "q1": "b",
        "q2": "c",
        "q3": "b",
        "q4": "a",
        "q5": "c",
      },
      total: 5,
    },
    "punch-walk": {
      version: 1,
      label: "Punch walks",
      certificateTitle: "MAGE ID skills: Punch walks",
      answers: {
        "q1": "b",
        "q2": "c",
        "q3": "a",
        "q4": "b",
        "q5": "b",
      },
      total: 5,
    },
    "schedule-say-it": {
      version: 1,
      label: "Schedule changes",
      certificateTitle: "MAGE ID skills: Schedule changes",
      answers: {
        "q1": "b",
        "q2": "c",
        "q3": "a",
        "q4": "c",
        "q5": "b",
      },
      total: 5,
    },
    "takeoff-to-estimate": {
      version: 1,
      label: "Takeoff",
      certificateTitle: "MAGE ID skills: Takeoff",
      answers: {
        "q1": "a",
        "q2": "b",
        "q3": "c",
        "q4": "b",
        "q5": "a",
      },
      total: 5,
    },
    "time-clock-in": {
      version: 1,
      label: "Time clock",
      certificateTitle: "MAGE ID skills: Time clock",
      answers: {
        "q1": "b",
        "q2": "c",
        "q3": "a",
        "q4": "b",
        "q5": "a",
      },
      total: 5,
    },
  },
};
