/**
 * Permission to send item photos to Anthropic's Claude (App Store guideline 5.1.2: say which
 * third-party AI gets user data, and ask first). Asked once per account; the answer is saved.
 */
import { confirm } from '@/lib/alert';
import { useStore } from '@/store/app-store';

export function useAiPhotoConsent() {
  const { state, actions } = useStore();
  /** Resolves true if photos may be sent (asking the first time). */
  return async function allowAiPhotos(): Promise<boolean> {
    const saved = state.profile?.aiPhotoConsent;
    if (saved !== null && saved !== undefined) return saved;
    const allowed = await confirm(
      'Use AI to read your photo?',
      'Lobb sends the photo to Anthropic’s Claude AI to recognize the product and look up its store price. It’s used only for that, not to train AI models. You can still type the name instead.',
      'Allow',
      { cancelLabel: 'Don’t allow', destructive: false },
    );
    await actions.setAiPhotoConsent(allowed).catch(() => {});
    return allowed;
  };
}
