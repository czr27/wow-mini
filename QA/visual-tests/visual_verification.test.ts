import assert from 'node:assert';
import { readFileSync } from 'node:fs';

export function runVisualVerificationTests() {
  console.log('--- 运行 [T-06] 画面与视觉特效渲染规范自动化验证 ---');

  // 1. 读取美术视觉主题定义
  const uiThemeRaw = readFileSync('g:/Desktop/wow_simu/ART/ui/UI_THEME.json', 'utf-8');
  const uiTheme = JSON.parse(uiThemeRaw);

  const effectsRaw = readFileSync('g:/Desktop/wow_simu/ART/effects/EFFECTS_MANIFEST.json', 'utf-8');
  const effectsManifest = JSON.parse(effectsRaw);

  const spriteRaw = readFileSync('g:/Desktop/wow_simu/ART/sprites/SPRITE_MANIFEST.json', 'utf-8');
  const spriteManifest = JSON.parse(spriteRaw);

  // ── 1. 职业配色规范验证
  const expectedClassColors: Record<string, string> = {
    DK: '#C41F3B',
    DRUID: '#FF7D0A',
    SHAMAN: '#0070DE',
    MAGE: '#69CCF0',
    ROGUE: '#FFF569',
  };

  for (const [cls, hex] of Object.entries(expectedClassColors)) {
    assert.strictEqual(
      uiTheme.classColors[cls],
      hex,
      `职业 ${cls} 的经典 HEX 颜色应为 ${hex}，实际为 ${uiTheme.classColors[cls]}`
    );
  }
  console.log('✓ 5大职业 85 级经典配色规范匹配验证通过 (DK红/德橙/萨蓝/法浅蓝/贼黄)');

  // ── 2. SCT 分级战斗浮动跳字颜色与动画特征验证
  const sctSpecs = uiTheme.sct;
  assert.ok(sctSpecs, 'UI主题中应包含SCT浮动战斗文字规范');

  assert.strictEqual(sctSpecs.crit.color, '#FFD700', 'SCT暴击跳字应为金橙色 #FFD700');
  assert.strictEqual(sctSpecs.crit.size, 21, 'SCT暴击跳字尺寸应为大号 21px (1.5x 缩放)');
  assert.strictEqual(sctSpecs.crit.animation, 'bounce_screenshake', 'SCT暴击跳字应伴随弹跳与震屏');

  assert.strictEqual(sctSpecs.heal.color, '#00FF7F', 'SCT治疗跳字应为翠绿色 #00FF7F');
  assert.strictEqual(sctSpecs.fire.color, '#FF6B35', '火焰法术跳字应为火焰橙红 #FF6B35');
  assert.strictEqual(sctSpecs.frost.color, '#56CCF2', '冰霜法术跳字应为亮蓝 #56CCF2');
  assert.strictEqual(sctSpecs.shadow.color, '#BB6BD9', '暗影法术跳字应为深紫 #BB6BD9');
  assert.strictEqual(sctSpecs.nature.color, '#6FCF97', '自然法术跳字应为翠绿 #6FCF97');
  assert.strictEqual(sctSpecs.interrupt.color, '#FF0000', '打断提示应为醒目红 #FF0000');
  console.log('✓ 高逼真度分级 SCT 浮动跳字（暴击1.5x金色加粗震屏/翠绿治疗/元素法术区分色）验证通过');

  // ── 3. 地面法阵与图腾特效视觉参数验证
  const groundEffects = effectsManifest.groundEffects;
  assert.ok(Array.isArray(groundEffects), '地面特效清单应为数组');

  // 萨满灵魂链接图腾
  const spiritLink = groundEffects.find((e: any) => e.id === 'totem_spirit_link');
  assert.ok(spiritLink, '应包含萨满灵魂链接图腾定义');
  assert.strictEqual(spiritLink.type, 'TOTEM');
  assert.strictEqual(spiritLink.colorHex, '#00CED1', '灵魂链接图腾应为青绿色 #00CED1');
  assert.ok(spiritLink.pulsePeriodMs > 0, '图腾应有周期性扩散光环周期');

  // 德鲁伊百花齐放
  const efflorescence = groundEffects.find((e: any) => e.id === 'druid_efflorescence');
  assert.ok(efflorescence, '应包含德鲁伊百花齐放地面法阵');
  assert.strictEqual(efflorescence.type, 'HEAL_ZONE');
  assert.strictEqual(efflorescence.colorHex, '#6FCF97', '百花齐放应为翠绿脉冲圆阵 #6FCF97');

  // 萨满治疗之雨
  const healingRain = groundEffects.find((e: any) => e.id === 'shaman_healing_rain');
  assert.ok(healingRain, '应包含萨满治疗之雨地面法阵');
  assert.strictEqual(healingRain.colorHex, '#56CCF2', '治疗之雨应为水蓝 #56CCF2');

  // 斯普林瓦尔亵渎毒圈
  const desecration = groundEffects.find((e: any) => e.id === 'desecration');
  assert.ok(desecration, '应包含指挥官斯普林瓦尔亵渎法阵');
  assert.strictEqual(desecration.type, 'DAMAGE_ZONE');
  assert.strictEqual(desecration.colorHex, '#006400', '亵渎应为暗绿毒圈 #006400');

  // 高弗雷双枪弹幕
  const pistolBarrage = groundEffects.find((e: any) => e.id === 'cone_warning_pistol_barrage');
  assert.ok(pistolBarrage, '应包含高弗雷双枪弹幕预警区');
  assert.strictEqual(pistolBarrage.type, 'CONE_WARNING');
  assert.strictEqual(pistolBarrage.colorHex, '#FF0000', '双枪弹幕预警区应为红色 #FF0000');
  assert.strictEqual(pistolBarrage.coneAngleDeg, 60, '双枪弹幕扇形扫射角度应为 60°');
  console.log('✓ 场地法阵与图腾特效视觉模拟（图腾扩散光环/百花齐放绿阵/亵渎毒雾/60°红色弹幕扇形）验证通过');

  // ── 4. 像素精灵尺寸与模型规格验证
  const classes = spriteManifest.classes;
  assert.strictEqual(classes.length, 5, '应定义5大职业精灵');
  for (const c of classes) {
    assert.strictEqual(c.size, 32, `职业 ${c.id} 精灵基准尺寸应为 32×32 像素`);
  }

  const bosses = spriteManifest.bosses;
  assert.strictEqual(bosses.length, 5, '应定义影牙城堡5首领模型');
  const godfrey = bosses.find((b: any) => b.id === 'godfrey');
  assert.ok(godfrey, '应包含高弗雷勋爵尾王模型');
  assert.ok(godfrey.size >= 64, '首领精灵尺寸应大于等于 64×64 像素');
  console.log('✓ 像素模型规格验证通过（角色 32×32，Boss 64×64 ~ 112×112）');

  console.log('✅ 所有画面视觉渲染与色彩体系规范自动化验证全部通过！\n');
}
