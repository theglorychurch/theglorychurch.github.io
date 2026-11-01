// @ts-check
import { defineConfig } from 'astro/config';

import sitemap from '@astrojs/sitemap';

// 도메인을 연결하면 SITE_URL 변수(또는 아래 기본값)를 새 주소로 바꾼다.
// 카카오톡·검색엔진 미리보기 이미지와 사이트맵 주소가 이 값을 따른다.
export default defineConfig({
  site: process.env.SITE_URL ?? 'https://theglorychurch.kr',
  integrations: [sitemap()],
});
