import type { Lang } from '../types'

// Yoruba strings MUST come from a native translator and be reviewed by community members.
// Do not machine-translate consent text. Until then, Yoruba falls back to English with a marker.
const en = {
  appName: 'Consent-First Kit',
  chooseLanguage: 'Choose a language',
  consentTitle: 'Before we start',
  consentIntro:
    'We would like to ask you some questions about your health. You decide how your answers are used. You can say no to any part, and you can change your mind later.',
  choiceCare: 'Use my answers for my care',
  choiceResearch: 'Use my answers for research, without my name',
  choiceAi: 'Use my answers to train AI tools',
  yes: 'Yes',
  no: 'No',
  continue: 'Continue',
  noConsent: 'Thank you. Nothing has been saved.',
  doneTitle: 'Thank you',
  checkCodeLabel: 'Your code to check or change your choices later',
  pending: 'waiting to sync',
}

type Strings = typeof en

const yo: Partial<Strings> = {
  // TODO(translator): fill every key. Missing keys fall back to English.
}

export function t(lang: Lang, key: keyof Strings): string {
  if (lang === 'yo') return yo[key] ?? `[YO] ${en[key]}`
  return en[key]
}
