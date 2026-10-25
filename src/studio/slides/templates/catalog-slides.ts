// 外来主题模板的出处表（全 MIT·版权行与授权网址随附）。
import type { SlidesTemplateMeta } from './catalog'

const REVEAL = { source: 'reveal.js', attribution: 'Copyright (C) 2011-2026 Hakim El Hattab', licenseUrl: 'https://github.com/hakimel/reveal.js/blob/master/LICENSE' }
const MARP = { source: 'Marp', attribution: 'Copyright (c) 2018 Marp team', licenseUrl: 'https://github.com/marp-team/marp-core/blob/main/LICENSE' }
const MARPSTYLE = { source: 'marpstyle', attribution: 'Copyright (c) 2021-2024 Paulo Cunha', licenseUrl: 'https://github.com/cunhapaulo/marpstyle/blob/main/LICENSE' }
const NEOBEAM = { source: 'neobeam', attribution: 'Copyright (c) 2024 Embracket', licenseUrl: 'https://github.com/mikael-ros/neobeam/blob/main/LICENSE' }
const SLIDEV = { source: 'Slidev', attribution: 'Copyright (c) 2021 Slidev.js Team', licenseUrl: 'https://github.com/slidevjs/themes/blob/main/LICENSE' }
const SHOWER = { source: 'Shower', attribution: 'Copyright © 2010–2024 Vadim Makeev', licenseUrl: 'https://github.com/shower/ribbon' }

export const SLIDES_TEMPLATE_META: readonly SlidesTemplateMeta[] = [
  { id: 'reveal-black', name: 'reveal.js Black', category: 'dark', desc: '深色·简约', ...REVEAL },
  { id: 'reveal-white', name: 'reveal.js White', category: 'minimal', desc: '简约·白底', ...REVEAL },
  { id: 'reveal-league', name: 'reveal.js League', category: 'dark', desc: '深色·商务（灰渐层）', ...REVEAL },
  { id: 'reveal-beige', name: 'reveal.js Beige', category: 'warm', desc: '暖色·简约', ...REVEAL },
  { id: 'reveal-night', name: 'reveal.js Night', category: 'dark', desc: '深色·科技', ...REVEAL },
  { id: 'reveal-serif', name: 'reveal.js Serif', category: 'academic', desc: '学术·衬线', ...REVEAL },
  { id: 'reveal-simple', name: 'reveal.js Simple', category: 'minimal', desc: '简约·白底', ...REVEAL },
  { id: 'reveal-solarized', name: 'reveal.js Solarized', category: 'academic', desc: '学术·柔和米黄', ...REVEAL },
  { id: 'reveal-moon', name: 'reveal.js Moon', category: 'dark', desc: '深色·蓝调', ...REVEAL },
  { id: 'reveal-dracula', name: 'reveal.js Dracula', category: 'dark', desc: '深色·科技（紫）', ...REVEAL },
  { id: 'reveal-sky', name: 'reveal.js Sky', category: 'fresh', desc: '清新·可爱（浅蓝圆体）', ...REVEAL },
  { id: 'marp-default', name: 'Marp Default', category: 'minimal', desc: '简约·白底', ...MARP },
  { id: 'marp-gaia', name: 'Marp Gaia', category: 'warm', desc: '暖色·商务', ...MARP },
  { id: 'marp-uncover', name: 'Marp Uncover', category: 'minimal', desc: '简约·居中大字', ...MARP },
  { id: 'marp-academic', name: 'Marp Academic', category: 'academic', desc: '学术（红标题）', source: 'marp-theme-academic', attribution: 'Copyright (c) 2022 Kaito Sugimoto', licenseUrl: 'https://github.com/kaisugi/marp-theme-academic/blob/main/LICENSE' },
  { id: 'marp-hegel', name: 'marpstyle Hegel', category: 'academic', desc: '学术·米白', ...MARPSTYLE },
  { id: 'marp-heidegger', name: 'marpstyle Heidegger', category: 'academic', desc: '学术·窄体字', ...MARPSTYLE },
  { id: 'marp-husserl', name: 'marpstyle Husserl', category: 'academic', desc: '学术·衬线', ...MARPSTYLE },
  { id: 'marp-neobeam', name: 'Neobeam', category: 'academic', desc: '学术（Beamer 风·蓝）', ...NEOBEAM },
  { id: 'marp-ecobeam', name: 'Neobeam Ecobeam', category: 'academic', desc: '学术·绿色', ...NEOBEAM },
  { id: 'marp-neonbeam', name: 'Neobeam Neonbeam', category: 'tech', desc: '科技·霓虹橘', ...NEOBEAM },
  { id: 'marp-oldenbeam', name: 'Neobeam Oldenbeam', category: 'academic', desc: '学术·古典衬线', ...NEOBEAM },
  { id: 'marp-dracula', name: 'Marp Dracula', category: 'dark', desc: '深色·科技', source: 'Dracula Theme', attribution: 'Copyright (c) 2020 Dracula Theme', licenseUrl: 'https://github.com/dracula/marp/blob/master/LICENSE' },
  { id: 'marp-cybertopia', name: 'Cybertopia', category: 'dark', desc: '深色·科技（黑底绿框）', source: 'cybertopia-marp', attribution: 'Copyright (c) 2024 Alexandre ZANNI', licenseUrl: 'https://github.com/noraj/cybertopia-marp/blob/master/LICENSE' },
  { id: 'marp-wave', name: 'Marp Wave', category: 'business', desc: '商务·深蓝波浪', source: 'MarpThemeWave', attribution: 'Copyright (c) 2023 Julius Wiedemann', licenseUrl: 'https://github.com/JuliusWiedemann/MarpThemeWave/blob/main/LICENSE' },
  { id: 'slidev-default', name: 'Slidev Default', category: 'tech', desc: '科技·深色大图封面', ...SLIDEV },
  { id: 'slidev-seriph', name: 'Slidev Seriph', category: 'business', desc: '商务·衬线大图封面', ...SLIDEV },
  { id: 'slidev-apple-basic', name: 'Slidev Apple Basic', category: 'minimal', desc: '简约·发布会风', ...SLIDEV },
  { id: 'slidev-bricks', name: 'Slidev Bricks', category: 'cute', desc: '可爱·几何色块', ...SLIDEV },
  { id: 'slidev-shibainu', name: 'Slidev Shibainu', category: 'cute', desc: '可爱·暖棕柴犬色', ...SLIDEV },
  { id: 'slidev-academic', name: 'Slidev Academic', category: 'academic', desc: '学术', source: 'slidev-theme-academic', attribution: 'Copyright (c) 2022 Alexander Eble', licenseUrl: 'https://github.com/alexanderdavide/slidev-theme-academic/blob/master/LICENSE' },
  { id: 'shower-ribbon', name: 'Shower Ribbon', category: 'business', desc: '商务·书签角标', ...SHOWER },
  { id: 'shower-material', name: 'Shower Material', category: 'minimal', desc: '简约·Material', ...SHOWER, licenseUrl: 'https://github.com/shower/material' },
]
