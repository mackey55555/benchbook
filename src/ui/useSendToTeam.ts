import { db } from '@/db/client';
import { findSimilarGame, sendGameToSpace } from '@/db/repo';
import type { Game, Space } from '@/db/schema';
import { syncNow, useTeamState } from '@/sync/session';

import { showDialog } from './dialog';
import { attempt } from './useGame';

/**
 * 個人で記録した試合を、チームへ送る（移す）。試合の画面と、試合一覧の長押しメニューから使う。
 * targets は送り先にできるチーム（なければ空）。start は確認を出してから送り、送れたら onSent を呼ぶ。
 */
export function useSendToTeam(): {
  targets: (game: Game) => Space[];
  start: (game: Game, onSent: () => void) => void;
} {
  const team = useTeamState();

  // 送れるのは、個人の置き場所にある、終了した試合だけ
  const targets = (game: Game): Space[] =>
    game.spaceId === null && game.status === 'finished' && team.userId ? team.spaces.filter((sp) => sp.active) : [];

  const sendTo = (game: Game, space: Space, onSent: () => void) => {
    const send = () => {
      let result: ReturnType<typeof sendGameToSpace> | undefined;
      if (!attempt(() => (result = sendGameToSpace(db, game.id, space.id)))) return;
      void syncNow();
      const notes = [
        result?.addedPlayers ? `チームの名簿に ${result.addedPlayers} 人を足しました。` : '',
        result?.unlinked
          ? `${result.unlinked} 人は、同じ背番号に別の名前の選手がいたため、名簿と結び付けていません。`
          : '',
      ].filter(Boolean);
      showDialog(`「${space.name}」に送りました`, ['メンバー全員のアプリに届きます。', ...notes].join('\n'));
      onSent();
    };
    const similar = findSimilarGame(db, game.id, space.id);
    showDialog(
      `「${space.name}」に送りますか？`,
      similar
        ? '同じ日・同じ対戦の試合が、すでにチームにあります。ほかの人が送った試合と重ならないか、確かめてください。'
        : 'この試合を個人からチームへ移します。メンバー全員が見て、直せるようになります。',
      [
        { text: 'キャンセル', style: 'cancel' },
        { text: similar ? 'それでも送る' : '送る', onPress: send },
      ],
    );
  };

  const start = (game: Game, onSent: () => void) => {
    const list = targets(game);
    if (list.length === 0) return;
    if (list.length === 1) return sendTo(game, list[0], onSent);
    showDialog('どのチームに送りますか？', undefined, [
      ...list.slice(0, 5).map((sp) => ({ text: sp.name, onPress: () => sendTo(game, sp, onSent) })),
      { text: 'キャンセル', style: 'cancel' as const },
    ]);
  };

  return { targets, start };
}
