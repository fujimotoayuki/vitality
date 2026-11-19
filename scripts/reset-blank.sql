-- 白紙アカウント（y901〜y903, a901〜a902）を「初めて使う人」の状態に戻す
DELETE FROM activity_logs WHERE user_id IN ('y901','y902','y903','a901','a902');
DELETE FROM consultations WHERE youth_user_id IN ('y901','y902','y903') OR adult_user_id IN ('a901','a902');
DELETE FROM youth_profiles WHERE user_id IN ('y901','y902','y903');
DELETE FROM adult_profiles WHERE user_id IN ('a901','a902');
UPDATE users SET display_name = '（未登録の若者1）' WHERE id = 'y901';
UPDATE users SET display_name = '（未登録の若者2）' WHERE id = 'y902';
UPDATE users SET display_name = '（未登録の若者3）' WHERE id = 'y903';
UPDATE users SET display_name = '（未登録の大人1）' WHERE id = 'a901';
UPDATE users SET display_name = '（未登録の大人2）' WHERE id = 'a902';
