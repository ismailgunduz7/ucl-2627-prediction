/**
 * Everything the API says in words.
 *
 * The server owns the text it produces itself: error messages, and the labels
 * it derives rather than stores (matchweek names, knockout rounds, fixture
 * difficulty, scoring rules). The interface owns its own copy. Nothing is
 * translated twice, and no Turkish string reaches a reader who asked for
 * English.
 *
 * `{name}` placeholders are filled by `t()`.
 */

export const LOCALES = ['tr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'tr';

type Catalog = Record<string, string>;

const tr: Catalog = {
  // ---- Errors ----------------------------------------------------------
  'errors.unauthorized': 'Kimlik doğrulanamadı',
  'errors.forbidden': 'Bunu yapma yetkin yok',
  'errors.bad_request': 'Geçersiz istek',
  'errors.not_found': 'Bulunamadı',
  'errors.internal_error': 'Sunucu hatası',
  'errors.invalid_access_token': 'Oturumun düşmüş, tekrar giriş yap',
  'errors.no_refresh_cookie': 'Oturum bulunamadı',
  'errors.invalid_credentials': 'Kullanıcı adı veya şifre hatalı',
  'errors.invalid_refresh_token': 'Oturum geçersiz',
  'errors.refresh_token_reused': 'Oturum süresi doldu',
  'errors.refresh_token_expired': 'Oturum süresi doldu',
  'errors.too_many_requests': 'Çok fazla deneme yaptın, {minutes} dakika sonra tekrar dene',
  'errors.credentials_required': 'Kullanıcı adı ve şifre gerekli',
  'errors.current_password_wrong': 'Mevcut şifren yanlış',
  'errors.invalid_language': 'Desteklenmeyen dil',
  'errors.invalid_release': 'Geçersiz sürüm',

  'errors.cron_disabled': 'CRON_SECRET tanımlı değil',
  'errors.invalid_cron_secret': 'Geçersiz cron anahtarı',

  'errors.too_many_accounts': 'Aynı anda en fazla {max} hesapla giriş yapabilirsin',
  'errors.competition_name_required': 'Yarışma adı gerekli',
  'errors.competition_not_found': 'Yarışma bulunamadı',
  'errors.competition_in_use': 'Bu yarışmada {count} hesap var. Önce onları başka bir yarışmaya taşı',
  'errors.invalid_user_body': 'Geçersiz kullanıcı bilgisi',
  'errors.password_required': 'Şifre boş olamaz',
  'errors.invalid_joker_counts': 'Geçersiz joker sayıları',
  'errors.user_not_found': 'Kullanıcı bulunamadı',
  'errors.invalid_config_body': 'Geçersiz ayar gövdesi',
  'errors.unknown_config_key': 'Bilinmeyen ayar: {key}',
  'errors.invalid_rule_update': 'Geçersiz kural güncellemesi',
  'errors.invalid_match_result': 'Geçersiz maç sonucu',
  'errors.invalid_sync_request': 'Geçersiz skor çekme isteği',
  'errors.competition_required': 'Katılımcıyı bir yarışmaya atamalısın',
  'errors.username_taken': 'Bu kullanıcı adı zaten kullanımda',
  'errors.cannot_delete_self': 'Kendi hesabını silemezsin',
  'errors.cannot_delete_last_admin': 'Son yönetici silinemez',

  'errors.lineup_body_required': 'Yedek ve kaptan gerekli',
  'errors.invalid_prediction_request': 'Geçersiz tahmin isteği',
  'errors.invalid_joker_request': 'Geçersiz joker isteği',
  'errors.invalid_transfer_request': 'Geçersiz transfer isteği',
  'errors.squad_size_required': 'Tam olarak {size} kulüp gönderilmeli',

  'errors.selection_locked': 'Kadro seçim süresi doldu',
  'errors.no_open_matchweek': 'Kadro kurabileceğin bir hafta kalmadı',
  'errors.wrong_size': 'Kadro tam olarak {size} kulüpten oluşmalı',
  'errors.duplicate_team': 'Aynı kulüp iki kez seçilemez',
  'errors.unknown_team': 'Geçersiz kulüp',
  'errors.inactive_team': 'Bu kulüp seçilemez',
  'errors.pot_not_covered': 'Her pottan tam olarak bir kulüp seçilmeli',

  'errors.non_integer_points': 'Puanlar tam sayı olmalı',
  'errors.invalid_tier': 'Geçersiz pot',
  'errors.unknown_rule': 'Bilinmeyen kural veya pot',
  'errors.score_required': 'Skor gerekli',
  'errors.match_not_found': 'Maç bulunamadı',
  'errors.no_override': 'Bu maçta elle girilmiş bir skor yok',
  'errors.team_not_found': 'Kulüp bulunamadı',

  'errors.no_transfer_grant': 'Transfer hakkın bulunmuyor',
  'errors.transfer_expired': 'Transfer penceresi kapandı',
  'errors.transfer_locked': 'Transfer penceresi kapandı',
  'errors.weekly_swap_active': 'Önce bu haftanın değişim jokerini iptal et',
  'errors.invalid_from': 'Çıkacak kulüp kadroda değil',
  'errors.to_in_squad': 'Bu kulüp zaten kadronda',
  'errors.invalid_to': 'Geçersiz kulüp',
  'errors.wrong_pot': 'Aynı pottan olmalı',
  'errors.to_ineligible': 'Elenmiş kulüp seçilemez',
  'errors.transfer_conflict': 'Kadron bu arada değişmiş, tekrar dene',
  'errors.joker_squad_conflict': 'Çıkardığın kulüpte aktif joker var. Devam edersen joker iptal edilir ve hakkın iade edilir',

  'errors.no_squad': 'Önce kadronu kurmalısın',
  'errors.matchweek_not_open': 'Bu hafta henüz düzenlemeye açılmadı',
  'errors.matchweek_locked': 'Bu hafta kilitlendi',
  'errors.bench_not_in_squad': 'Yedeğe çektiğin kulüp kadroda değil',
  'errors.captain_not_in_squad': 'Kaptan yaptığın kulüp kadroda değil',
  'errors.captain_on_bench': 'Yedekteki kulüp kaptan olamaz',
  'errors.swap_club_cannot_bench': 'Bu hafta takasla gelen kulüp yedeğe çekilemez',
  'errors.joker_bench_conflict': 'Kalkan taktığın kulübü yedeğe çekiyorsun',

  'errors.predictions_locked': 'Tahminler kilitlendi',
  'errors.match_not_in_week': 'Maç bu haftaya ait değil',
  'errors.invalid_pick': 'Geçersiz tahmin',

  'errors.player_not_found': 'Oyuncu bulunamadı',
  'errors.different_competition': 'Bu oyuncuyu görüntüleyemezsin',

  'errors.swap_teams_required': 'Değişim kulüpleri gerekli',
  'errors.shield_target_required': 'Hedef kulüp gerekli',
  'errors.target_not_in_squad': 'Hedef kulüp kadroda değil',
  'errors.target_on_bench': 'Yedekteki kulübe kalkan takılamaz',
  'errors.joker_already_active': 'Bu hafta zaten bir joker oynadın. Önce onu geri al',
  'errors.no_inventory': 'Bu jokerden hakkın kalmadı',
  'errors.no_active_joker': 'Aktif joker yok',

  // ---- Derived labels --------------------------------------------------
  'matchweek.league_week': 'Hafta {number}',
  'matchweek.league_group': 'Lig aşaması',
  'round.final': 'Final',
  'round.sf': 'Yarı final',
  'round.qf': 'Çeyrek final',
  'round.r16': 'Son 16',
  'round.playoff': 'Play-off',
  'leg.first': 'İlk maçlar',
  'leg.second': 'Rövanş maçları',
  'leg.nth': '{number}. maç',

  'difficulty.easy': 'kolay',
  'difficulty.medium': 'orta',
  'difficulty.hard': 'zor',

  'tier.name': 'Pot {number}',

  'rule.win': 'Galibiyet',
  'rule.draw': 'Beraberlik',
  'rule.loss': 'Mağlubiyet',
  'rule.goals_scored': 'Atılan gol (adet)',
  'rule.goals_conceded': 'Yenilen gol (adet)',
  'rule.clean_sheet': 'Gol yememe',
  'rule.league_top8_bonus': 'Lig ilk 8 bonusu',
  'rule.round_advance': 'Tur atlama',
  'rule.gold_medal': 'Şampiyonluk',
  'rule.silver_medal': 'Finalist (ikinci)',
  'rule.captain': 'Kaptanlık',
  'delta.captain': 'Kaptan ×{multiplier}',
  'joker.clean_sheet_shield': 'Gol yememe kalkanı',

  'rule_warning.pot_count': 'Her kural için 4 pot değeri gerekli',
  'rule_warning.not_flat': 'Bu kural bütün potlarda eşit olmalı',
  'rule_warning.reward_order': 'Ödül bozuk: değerler Pot 1 den Pot 4 e doğru azalmamalı',
  'rule_warning.penalty_order': 'Ceza bozuk: değerler Pot 1 den Pot 4 e doğru azalmamalı',
};

const en: Catalog = {
  // ---- Errors ----------------------------------------------------------
  'errors.unauthorized': 'We could not verify who you are',
  'errors.forbidden': 'You are not allowed to do that',
  'errors.bad_request': 'That request does not make sense',
  'errors.not_found': 'Not found',
  'errors.internal_error': 'Server error',
  'errors.invalid_access_token': 'Your session has ended, sign in again',
  'errors.no_refresh_cookie': 'No session found',
  'errors.invalid_credentials': 'Wrong username or password',
  'errors.invalid_refresh_token': 'That session is not valid',
  'errors.refresh_token_reused': 'Your session has expired',
  'errors.refresh_token_expired': 'Your session has expired',
  'errors.too_many_requests': 'Too many attempts, try again in {minutes} minutes',
  'errors.credentials_required': 'Username and password are required',
  'errors.current_password_wrong': 'That is not your current password',
  'errors.invalid_language': 'That language is not supported',
  'errors.invalid_release': 'That is not a version',

  'errors.cron_disabled': 'CRON_SECRET is not set',
  'errors.invalid_cron_secret': 'Wrong cron key',

  'errors.too_many_accounts': 'You can hold at most {max} accounts signed in at once',
  'errors.competition_name_required': 'The competition needs a name',
  'errors.competition_not_found': 'No such competition',
  'errors.competition_in_use': 'This competition still holds {count} accounts. Move them somewhere else first',
  'errors.invalid_user_body': 'Those account details are not valid',
  'errors.password_required': 'The password cannot be empty',
  'errors.invalid_joker_counts': 'Those joker counts are not valid',
  'errors.user_not_found': 'No such account',
  'errors.invalid_config_body': 'Those settings are not valid',
  'errors.unknown_config_key': 'Unknown setting: {key}',
  'errors.invalid_rule_update': 'That rule change is not valid',
  'errors.invalid_match_result': 'That match result is not valid',
  'errors.invalid_sync_request': 'That score pull request is not valid',
  'errors.competition_required': 'A player has to belong to a competition',
  'errors.username_taken': 'That username is taken',
  'errors.cannot_delete_self': 'You cannot delete your own account',
  'errors.cannot_delete_last_admin': 'The last admin cannot be deleted',

  'errors.lineup_body_required': 'A bench club and a captain are required',
  'errors.invalid_prediction_request': 'That prediction is not valid',
  'errors.invalid_joker_request': 'That joker request is not valid',
  'errors.invalid_transfer_request': 'That transfer request is not valid',
  'errors.squad_size_required': 'Send exactly {size} clubs',

  'errors.selection_locked': 'Squad selection has closed',
  'errors.no_open_matchweek': 'There is no week left to build a squad for',
  'errors.wrong_size': 'A squad is exactly {size} clubs',
  'errors.duplicate_team': 'You cannot pick the same club twice',
  'errors.unknown_team': 'No such club',
  'errors.inactive_team': 'That club cannot be picked',
  'errors.pot_not_covered': 'Pick exactly one club from every pot',

  'errors.non_integer_points': 'Points have to be whole numbers',
  'errors.invalid_tier': 'No such pot',
  'errors.unknown_rule': 'No such rule or pot',
  'errors.score_required': 'A score is required',
  'errors.match_not_found': 'No such match',
  'errors.no_override': 'Nobody entered this score by hand',
  'errors.team_not_found': 'No such club',

  'errors.no_transfer_grant': 'You have no transfer to make',
  'errors.transfer_expired': 'The transfer window has closed',
  'errors.transfer_locked': 'The transfer window has closed',
  'errors.weekly_swap_active': 'Cancel the swap joker on this week first',
  'errors.invalid_from': 'The club leaving is not in your squad',
  'errors.to_in_squad': 'That club is already in your squad',
  'errors.invalid_to': 'No such club',
  'errors.wrong_pot': 'It has to come from the same pot',
  'errors.to_ineligible': 'A knocked-out club cannot be picked',
  'errors.transfer_conflict': 'Your squad changed in the meantime, try again',
  'errors.joker_squad_conflict': 'The club you are dropping has a live joker. Carrying on cancels it and gives the joker back',

  'errors.no_squad': 'Build your squad first',
  'errors.matchweek_not_open': 'This week is not open for edits yet',
  'errors.matchweek_locked': 'This week is locked',
  'errors.bench_not_in_squad': 'The club you benched is not in your squad',
  'errors.captain_not_in_squad': 'The club you captained is not in your squad',
  'errors.captain_on_bench': 'A benched club cannot be captain',
  'errors.swap_club_cannot_bench': 'A club swapped in for this week cannot be benched',
  'errors.joker_bench_conflict': 'You are benching the club your shield is on',

  'errors.predictions_locked': 'Predictions are locked',
  'errors.match_not_in_week': 'That match is not in this week',
  'errors.invalid_pick': 'That pick is not valid',

  'errors.player_not_found': 'No such player',
  'errors.different_competition': 'You cannot see this player',

  'errors.swap_teams_required': 'Both swap clubs are required',
  'errors.shield_target_required': 'A target club is required',
  'errors.target_not_in_squad': 'The target club is not in your squad',
  'errors.target_on_bench': 'A benched club cannot take the shield',
  'errors.joker_already_active': 'You already played a joker this week. Take it back first',
  'errors.no_inventory': 'You have none of that joker left',
  'errors.no_active_joker': 'No joker is live',

  // ---- Derived labels --------------------------------------------------
  'matchweek.league_week': 'Week {number}',
  'matchweek.league_group': 'League phase',
  'round.final': 'Final',
  'round.sf': 'Semi-finals',
  'round.qf': 'Quarter-finals',
  'round.r16': 'Round of 16',
  'round.playoff': 'Play-offs',
  'leg.first': 'First legs',
  'leg.second': 'Second legs',
  'leg.nth': 'Leg {number}',

  'difficulty.easy': 'easy',
  'difficulty.medium': 'even',
  'difficulty.hard': 'hard',

  'tier.name': 'Pot {number}',

  'rule.win': 'Win',
  'rule.draw': 'Draw',
  'rule.loss': 'Loss',
  'rule.goals_scored': 'Goal scored (each)',
  'rule.goals_conceded': 'Goal conceded (each)',
  'rule.clean_sheet': 'Clean sheet',
  'rule.league_top8_bonus': 'League top 8 bonus',
  'rule.round_advance': 'Round won',
  'rule.gold_medal': 'Winners',
  'rule.silver_medal': 'Runners-up',
  'rule.captain': 'Captaincy',
  'delta.captain': 'Captain ×{multiplier}',
  'joker.clean_sheet_shield': 'Clean-sheet shield',

  'rule_warning.pot_count': 'Every rule needs four pot values',
  'rule_warning.not_flat': 'This rule has to be equal across every pot',
  'rule_warning.reward_order': 'Reward is inverted: values must not fall from Pot 1 to Pot 4',
  'rule_warning.penalty_order': 'Penalty is inverted: values must not fall from Pot 1 to Pot 4',
};

export const MESSAGES: Record<Locale, Catalog> = { tr, en };
