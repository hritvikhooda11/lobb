import { router } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Button, Icon, Txt, tap } from '@/components/ui';
import { attempt } from '@/lib/alert';
import { useStore } from '@/store/app-store';
import { radius, space, useTheme } from '@/theme';

/** Enter a seller code from Lobb to become a wholesale seller (stock items in your room, earn on every delivery). */
export default function SellerCode() {
  const { colors } = useTheme();
  const { actions } = useStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    const ok = await attempt(() => actions.redeemSellerCode(code));
    setBusy(false);
    if (!ok) return;
    tap('success');
    router.replace('/stock');
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.xl, gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <Icon name="storefront" size={28} tone="primary" />
        <Txt variant="title">Wholesale seller</Txt>
        <Txt tone="muted">Keep items stocked in your room and earn on every delivery. Enter the seller code Lobb gave you.</Txt>
      </View>
      <TextInput
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="SELLER CODE"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        maxLength={32}
        returnKeyType="go"
        onSubmitEditing={() => code.trim().length >= 6 && !busy && void join()}
        style={{ height: 52, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg, color: colors.text, fontSize: 18, letterSpacing: 2 }}
      />
      <Button label={busy ? 'Checking…' : 'Become a seller'} disabled={code.trim().length < 6 || busy} onPress={join} />
    </View>
  );
}
