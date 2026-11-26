import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BGM_VOLUME,
  getBgmVolume,
  getEffectiveBgmGain,
  setBgmVolume,
  resolveBgmTrackInfo,
  getDungeonAudioUrls,
  getAllAudioUrls,
} from '../bgmManager.js';

describe('bgmManager', () => {
  it('defaults BGM volume to 30% and clamps updates to [0, 1] with -50% actual gain', () => {
    assert.equal(DEFAULT_BGM_VOLUME, 0.3);
    assert.equal(getBgmVolume(), 0.3);
    assert.equal(getEffectiveBgmGain(0.3), 0.15);
    assert.equal(setBgmVolume(0.8), 0.8);
    assert.equal(getBgmVolume(), 0.8);
    assert.equal(getEffectiveBgmGain(), 0.4);
    assert.equal(setBgmVolume(2.5), 1);
    assert.equal(setBgmVolume(-0.4), 0);
    setBgmVolume(DEFAULT_BGM_VOLUME);
  });

  it('resolves AUTH_UNLOGGED, LOBBY_OUTSIDE, and ROOM_WAITING tracks', () => {
    const auth = resolveBgmTrackInfo({ phase: 'AUTH_UNLOGGED' });
    assert.equal(auth.type, 'AUTH_UNLOGGED');
    assert.equal(auth.url, '/audio/bgm/auth_unlogged.ogg');

    const outside = resolveBgmTrackInfo({ phase: 'LOBBY_OUTSIDE' });
    assert.equal(outside.type, 'LOBBY_OUTSIDE');
    assert.ok(outside.url?.startsWith('/audio/bgm/outside_'));

    const room = resolveBgmTrackInfo({ phase: 'ROOM_WAITING' });
    assert.equal(room.type, 'ROOM_WAITING');
    assert.ok(room.url?.startsWith('/audio/bgm/room_wait_'));
  });

  it('resolves TRAVEL_RECOVERY as random maze track', () => {
    const res = resolveBgmTrackInfo({ phase: 'TRAVEL_RECOVERY', dungeonId: 'shadowfang_keep' });
    assert.equal(res.type, 'DUNGEON_AMBIENT');
    assert.ok(res.url === '/audio/bgm/maze_1.ogg' || res.url === '/audio/bgm/maze_2.ogg');
  });

  it('resolves BOSS_COMBAT per specific bossId', () => {
    const cookie = resolveBgmTrackInfo({
      phase: 'BOSS_COMBAT',
      dungeonId: 'deadmines',
      bossIndex: 4,
      totalBosses: 6,
      bossId: 'cookie',
    });
    assert.equal(cookie.type, 'BOSS_STANDARD');
    assert.equal(cookie.url, '/audio/bgm/boss_dm_cookie.ogg');

    const madness = resolveBgmTrackInfo({
      phase: 'BOSS_COMBAT',
      dungeonId: 'dragon_soul',
      bossIndex: 7,
      totalBosses: 8,
      bossId: 'madness',
    });
    assert.equal(madness.type, 'BOSS_FINAL_EPIC');
    assert.equal(madness.url, '/audio/bgm/boss_ds_madness.ogg');
  });

  it('resolves WIPE_VOTE (thunder on final boss, dungeon wipe on intermediate)', () => {
    const midWipe = resolveBgmTrackInfo({
      phase: 'WIPE_VOTE',
      dungeonId: 'shadowfang_keep',
      bossIndex: 1,
      totalBosses: 5,
    });
    assert.equal(midWipe.type, 'WIPE_STINGER');
    assert.equal(midWipe.url, '/audio/bgm/wipe_sfk.ogg');
    assert.equal(midWipe.loop, false);

    const finalWipe = resolveBgmTrackInfo({
      phase: 'WIPE_VOTE',
      dungeonId: 'shadowfang_keep',
      bossIndex: 4,
      totalBosses: 5,
    });
    assert.equal(finalWipe.type, 'WIPE_STINGER');
    assert.ok(finalWipe.url?.startsWith('/audio/bgm/wipe_thunder_'));
  });

  it('resolves SUMMARY as dungeon final clear stinger', () => {
    const res = resolveBgmTrackInfo({ phase: 'SUMMARY', dungeonId: 'dragon_soul' });
    assert.equal(res.type, 'VICTORY_SUMMARY');
    assert.equal(res.url, '/audio/bgm/clear_final_ds.ogg');
    assert.equal(res.loop, false);
  });

  it('collects dungeon-specific and full assigned audio URLs for preloading', () => {
    const sfkUrls = getDungeonAudioUrls('shadowfang_keep');
    assert.ok(sfkUrls.includes('/audio/bgm/boss_sfk_godfrey.ogg'));
    assert.ok(sfkUrls.includes('/audio/bgm/clear_final_sfk.ogg'));
    assert.ok(sfkUrls.includes('/audio/bgm/wipe_sfk.ogg'));
    assert.ok(!sfkUrls.includes('/audio/bgm/boss_ds_madness.ogg'));

    const allUrls = getAllAudioUrls();
    assert.ok(allUrls.length >= 65);
    assert.ok(allUrls.includes('/audio/bgm/auth_unlogged.ogg'));
    assert.ok(allUrls.includes('/audio/bgm/sfx_raid_buff.ogg'));
  });
});
