import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, ItemBadge, Row, Txt, tap } from '@/components/ui';
import { showError } from '@/lib/alert';
import { useThread, type Message, type Thread } from '@/lib/chat';
import { supabase } from '@/lib/supabase';
import { useItem, useStore } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

const QUICK_REPLIES = ['On my way!', 'I’m in the lobby', 'Which room?', 'Be there in 2 min', 'Thanks!'];

/**
 * One chat thread. `?request=<id>` for an order (buyer ↔ neighbor delivering), or
 * `?shoutout=<id>&neighbor=<userId>` for a shout-out (poster ↔ one neighbor).
 */
export default function Chat() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { state } = useStore();
  const params = useLocalSearchParams<{ request?: string; shoutout?: string; neighbor?: string }>();
  const thread: Thread | null = params.request ? { requestId: params.request } : params.shoutout && params.neighbor ? { shoutoutId: params.shoutout, neighborId: params.neighbor } : null;
  const { messages, loaded, send } = useThread(thread);
  const [draft, setDraft] = useState('');
  const list = useRef<FlatList<Message>>(null);
  const myId = state.userId ?? '';

  // Who's on the other side, and what it's about.
  const request = state.requests.find((r) => r.id === params.request);
  const job = state.jobs.find((j) => j.id === params.request);
  const shoutout = state.shoutouts.find((s) => s.id === params.shoutout);
  const item = useItem(request?.itemId ?? job?.itemId);
  const [neighborName, setNeighborName] = useState<string | null>(null);
  useEffect(() => {
    if (!shoutout?.mine || !params.neighbor) return;
    void supabase
      .from('profiles')
      .select('name')
      .eq('id', params.neighbor)
      .maybeSingle()
      .then(({ data }) => setNeighborName((data?.name as string) ?? null));
  }, [shoutout?.mine, params.neighbor]);

  const otherName = request ? (request.deliverer?.name ?? 'Your neighbor') : job ? job.buyerName : shoutout ? (shoutout.mine ? (neighborName ?? 'Neighbor') : shoutout.posterName) : 'Neighbor';
  const subject = item ? item.name : shoutout ? `Shout-out: ${shoutout.text}` : '';
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const rows = useMemo(() => [...messages].reverse(), [messages]);

  async function submit(text: string) {
    if (!text.trim()) return;
    tap();
    setDraft('');
    try {
      await send(text, myId);
    } catch (e) {
      setDraft(text);
      showError(e instanceof Error ? e.message : 'Couldn’t send that.');
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.lg, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <Row>
          <Pressable onPress={goBack} hitSlop={12}>
            <Icon name="chevron-back" size={26} tone="primary" />
          </Pressable>
          {item ? (
            <ItemBadge item={item} size={38} />
          ) : (
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
              <Txt variant="label" tone="onPrimary">
                {otherName[0]}
              </Txt>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Txt variant="heading" numberOfLines={1}>
              {otherName}
            </Txt>
            {subject ? (
              <Txt variant="caption" tone="muted" numberOfLines={1}>
                {subject}
              </Txt>
            ) : null}
          </View>
        </Row>
      </View>

      <FlatList
        ref={list}
        data={rows}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        keyboardDismissMode="interactive"
        renderItem={({ item: m }) => <Bubble message={m} mine={m.senderId === myId} />}
        ListFooterComponent={
          loaded && messages.length === 0 ? (
            <Txt tone="muted" center style={{ marginBottom: space.lg }}>
              {shoutout && !shoutout.mine ? `Ask ${otherName} anything about it before you claim it.` : `Say hi to ${otherName}. Only the two of you can see this chat.`}
            </Txt>
          ) : undefined
        }
      />

      {!thread ? null : (
        <View style={{ paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: insets.bottom + space.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, gap: space.sm }}>
          {messages.length < 2 ? (
            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              {QUICK_REPLIES.map((q) => (
                <Pressable key={q} onPress={() => void submit(q)} style={{ paddingHorizontal: 12, height: 32, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: colors.primarySoft }}>
                  <Txt variant="caption" tone="primary" style={{ fontWeight: '600' }}>
                    {q}
                  </Txt>
                </Pressable>
              ))}
            </Row>
          ) : null}
          <Row gap={space.sm}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={500}
              style={{ flex: 1, minHeight: 42, maxHeight: 120, borderRadius: 21, backgroundColor: colors.surfaceHigh, paddingHorizontal: space.lg, paddingTop: 11, paddingBottom: 11, color: colors.text, fontSize: 16 }}
            />
            <Pressable
              onPress={() => void submit(draft)}
              disabled={!draft.trim()}
              style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, opacity: draft.trim() ? 1 : 0.4 }}>
              <Icon name="arrow-up" size={22} tone="onPrimary" />
            </Pressable>
          </Row>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function Bubble({ message: m, mine }: { message: Message; mine: boolean }) {
  const { colors } = useTheme();
  const time = new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%', gap: 2 }}>
      <View
        style={{
          backgroundColor: mine ? colors.primary : colors.surfaceHigh,
          borderRadius: radius.lg,
          borderBottomRightRadius: mine ? 6 : radius.lg,
          borderBottomLeftRadius: mine ? radius.lg : 6,
          paddingHorizontal: 14,
          paddingVertical: 9,
          opacity: m.pending ? 0.6 : 1,
        }}>
        <Txt style={{ color: mine ? colors.onPrimary : colors.text, fontSize: 16, lineHeight: 21 }}>{m.body}</Txt>
      </View>
      <Txt variant="caption" tone="muted" style={{ alignSelf: mine ? 'flex-end' : 'flex-start', fontSize: 11, fontFamily: fonts.displayMedium }}>
        {m.pending ? 'Sending…' : time}
      </Txt>
    </View>
  );
}
