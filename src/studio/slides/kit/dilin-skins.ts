// 堤麟原創 13 套 deck 模板抽出的皮肤（extract-dilin-skins.mjs 生成·别手改·改模板后重跑：node core/lib/slide-kit/preview/extract-dilin-skins.mjs）
//   皮肤＝Theme（主题记号 theme:* 照 resolvePalette 解析）＋各页型装饰层 layers（背景图／缎带／角花等·组件编号前缀 skin.·派生时换成 <页键>.skin.）。
//   deck 套用 dilin-* 模板后 themeId＝skinId＝模板 id；之后加页／按版式派生＝装饰层＋版式蓝图（见 ./skins.ts、components/derive.ts）。
import type { PageType, Theme } from './types'
import type { SlideComponent } from './components/types'

export type DilinSkin = Theme & {
  /** 抽自哪套模板（＝皮肤 id） */
  skinOf: string
  /** 模板原主色（primary 为过 AA 压深前的那个·一般＝primary） */
  brandPrimary: string
  /** 页型 ⇒ 装饰层（铺在版式蓝图下面） */
  layers: Partial<Record<PageType, SlideComponent[]>>
}

export const DILIN_SKINS: readonly DilinSkin[] = [
  {
    "id": "dilin-bizplan",
    "name": "青禾新芽",
    "primary": "#1F6B2E",
    "secondary": "#CDE9BD",
    "accent": "#3FAF4A",
    "darkMode": "sandwich",
    "brandPrimary": "#1F6B2E",
    "fontPair": {
      "heading": "Noto Sans TC",
      "body": "Noto Sans TC"
    },
    "bg": "#FFFFFF",
    "ink": {
      "heading": "#1E2B1F",
      "body": "#6C7A6D"
    },
    "darkInk": {
      "heading": "#FFFFFF",
      "body": "#E4F7D6"
    },
    "decor": "堤麟原創「青禾新芽」皮肤（場景-商業計劃）·抽自 dilin-bizplan.tw.json",
    "skinOf": "dilin-bizplan",
    "layers": {
      "cover": [
        {
          "id": "skin.c002",
          "type": "shape",
          "frame": {
            "x": -260,
            "y": -120,
            "w": 900,
            "h": 800,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#3FAF4A",
          "stroke": null,
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c003",
          "type": "shape",
          "frame": {
            "x": -270,
            "y": -130,
            "w": 920,
            "h": 820,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#9BD86B",
          "stroke": null,
          "role": "decor",
          "opacity": 0.35
        }
      ],
      "contents": [
        {
          "id": "skin.img008",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-bizplan/img008.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.img008-mask",
          "type": "shape",
          "role": "backgroundMask",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "theme:bg",
          "stroke": null,
          "opacity": 0.82,
          "locked": true
        }
      ],
      "transition": [
        {
          "id": "skin.img028",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-bizplan/img028.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c029",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#1F6B2E",
          "stroke": null,
          "role": "backgroundMask",
          "opacity": 0.35,
          "locked": true
        }
      ],
      "end": [
        {
          "id": "skin.c070",
          "type": "shape",
          "frame": {
            "x": -260,
            "y": -120,
            "w": 900,
            "h": 800,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#3FAF4A",
          "stroke": null,
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c071",
          "type": "shape",
          "frame": {
            "x": -270,
            "y": -130,
            "w": 920,
            "h": 820,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#9BD86B",
          "stroke": null,
          "role": "decor",
          "opacity": 0.35
        }
      ]
    }
  },
  {
    "id": "dilin-business",
    "name": "深海鎏金",
    "primary": "#7F653E",
    "secondary": "#C9D2E3",
    "accent": "#14284B",
    "darkMode": "sandwich",
    "brandPrimary": "#B8925A",
    "fontPair": {
      "heading": "Noto Sans TC",
      "body": "Noto Sans TC"
    },
    "bg": "#FFFFFF",
    "ink": {
      "heading": "#14284B",
      "body": "#6B7280"
    },
    "darkInk": {
      "heading": "#FFFFFF",
      "body": "#6B7280"
    },
    "decor": "堤麟原創「深海鎏金」皮肤（風格-商務風）·抽自 dilin-business.tw.json",
    "skinOf": "dilin-business",
    "layers": {
      "cover": [
        {
          "id": "skin.c002",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 610,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#14284B",
          "stroke": null,
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c003",
          "type": "shape",
          "frame": {
            "x": 56,
            "y": 60,
            "w": 18,
            "h": 18,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#FFFFFF",
          "stroke": null,
          "role": "decor"
        },
        {
          "id": "skin.c009",
          "type": "shape",
          "frame": {
            "x": 56,
            "y": 470,
            "w": 14,
            "h": 14,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#B8925A",
          "stroke": null,
          "role": "decor"
        }
      ],
      "contents": [
        {
          "id": "skin.c010",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 300,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#14284B",
          "stroke": null,
          "role": "background",
          "locked": true
        }
      ],
      "transition": [
        {
          "id": "skin.c032",
          "type": "shape",
          "frame": {
            "x": 40,
            "y": 40,
            "w": 22,
            "h": 22,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#14284B",
          "stroke": null,
          "role": "decor"
        },
        {
          "id": "skin.c033",
          "type": "shape",
          "frame": {
            "x": 62,
            "y": 62,
            "w": 22,
            "h": 22,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#FFFFFF",
          "stroke": null,
          "role": "decor"
        }
      ],
      "end": [
        {
          "id": "skin.c083",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 300,
            "w": 1000,
            "h": 262.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#B8925A",
          "stroke": null,
          "role": "background",
          "locked": true
        }
      ]
    }
  },
  {
    "id": "dilin-campus",
    "name": "學府靛青",
    "primary": "#4C5BB0",
    "secondary": "#C8CCE6",
    "accent": "#8FD3B0",
    "darkMode": "sandwich",
    "brandPrimary": "#4C5BB0",
    "fontPair": {
      "heading": "Noto Serif TC",
      "body": "Noto Sans TC"
    },
    "bg": "#F4F6FB",
    "ink": {
      "heading": "#2E3A7A",
      "body": "#6E7390"
    },
    "darkInk": {
      "heading": "#FFFFFF",
      "body": "#1E2440"
    },
    "decor": "堤麟原創「學府靛青」皮肤（場景-高校專區）·抽自 dilin-campus.tw.json",
    "skinOf": "dilin-campus",
    "layers": {
      "cover": [
        {
          "id": "skin.img001",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 330,
            "rotate": 0
          },
          "src": "templates/slides/dilin-campus/img001.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c002",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 330,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#4C5BB0",
          "stroke": null,
          "role": "backgroundMask",
          "opacity": 0.55,
          "locked": true
        },
        {
          "id": "skin.c003",
          "type": "shape",
          "frame": {
            "x": -200,
            "y": 250,
            "w": 1400,
            "h": 560,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#8FD3B0",
          "stroke": null,
          "role": "decor",
          "opacity": 1
        },
        {
          "id": "skin.c004",
          "type": "shape",
          "frame": {
            "x": -200,
            "y": 258,
            "w": 1400,
            "h": 560,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#F4F6FB",
          "stroke": null,
          "role": "decor"
        },
        {
          "id": "skin.c011",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 548,
            "w": 1000,
            "h": 14.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#4C5BB0",
          "stroke": null,
          "role": "decor"
        }
      ],
      "contents": [
        {
          "id": "skin.c012",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 548,
            "w": 1000,
            "h": 14.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#4C5BB0",
          "stroke": null,
          "role": "decor"
        },
        {
          "id": "skin.c013",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 8,
            "h": 548,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#8FD3B0",
          "stroke": null,
          "role": "decor"
        }
      ],
      "transition": [
        {
          "id": "skin.img032",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 300,
            "rotate": 0
          },
          "src": "templates/slides/dilin-campus/img032.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c033",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 300,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#4C5BB0",
          "stroke": null,
          "role": "backgroundMask",
          "opacity": 0.55,
          "locked": true
        },
        {
          "id": "skin.c034",
          "type": "shape",
          "frame": {
            "x": -200,
            "y": 220,
            "w": 1400,
            "h": 560,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#8FD3B0",
          "stroke": null,
          "role": "decor",
          "opacity": 1
        },
        {
          "id": "skin.c035",
          "type": "shape",
          "frame": {
            "x": -200,
            "y": 228,
            "w": 1400,
            "h": 560,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#F4F6FB",
          "stroke": null,
          "role": "decor"
        },
        {
          "id": "skin.c040",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 548,
            "w": 1000,
            "h": 14.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#4C5BB0",
          "stroke": null,
          "role": "decor"
        }
      ],
      "content": [
        {
          "id": "skin.c044",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 548,
            "w": 1000,
            "h": 14.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#4C5BB0",
          "stroke": null,
          "role": "decor"
        }
      ],
      "end": [
        {
          "id": "skin.img073",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 330,
            "rotate": 0
          },
          "src": "templates/slides/dilin-campus/img073.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c074",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 330,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#4C5BB0",
          "stroke": null,
          "role": "backgroundMask",
          "opacity": 0.55,
          "locked": true
        },
        {
          "id": "skin.c075",
          "type": "shape",
          "frame": {
            "x": -200,
            "y": 250,
            "w": 1400,
            "h": 560,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#8FD3B0",
          "stroke": null,
          "role": "decor",
          "opacity": 1
        },
        {
          "id": "skin.c076",
          "type": "shape",
          "frame": {
            "x": -200,
            "y": 258,
            "w": 1400,
            "h": 560,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#F4F6FB",
          "stroke": null,
          "role": "decor"
        },
        {
          "id": "skin.c080",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 548,
            "w": 1000,
            "h": 14.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#4C5BB0",
          "stroke": null,
          "role": "decor"
        }
      ]
    }
  },
  {
    "id": "dilin-cartoon",
    "name": "薄荷泡泡",
    "primary": "#257A4E",
    "secondary": "#BFE9D4",
    "accent": "#FF8A3D",
    "darkMode": "sandwich",
    "brandPrimary": "#35A86B",
    "fontPair": {
      "heading": "Huninn",
      "body": "Huninn"
    },
    "bg": "#F3FBF7",
    "ink": {
      "heading": "#23332B",
      "body": "#6C7F75"
    },
    "darkInk": {
      "heading": "#FFFFFF",
      "body": "#DFF6EA"
    },
    "decor": "堤麟原創「薄荷泡泡」皮肤（風格-可愛卡通）·抽自 dilin-cartoon.tw.json",
    "skinOf": "dilin-cartoon",
    "layers": {
      "cover": [
        {
          "id": "skin.c015",
          "type": "shape",
          "frame": {
            "x": 882,
            "y": 36,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c016",
          "type": "shape",
          "frame": {
            "x": 882,
            "y": 62,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c024",
          "type": "shape",
          "frame": {
            "x": 930,
            "y": 470,
            "w": 50,
            "h": 50,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#FF8A3D",
          "stroke": null,
          "role": "decor"
        }
      ],
      "contents": [
        {
          "id": "skin.c025",
          "type": "shape",
          "frame": {
            "x": 40,
            "y": 460,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c026",
          "type": "shape",
          "frame": {
            "x": 40,
            "y": 486,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c027",
          "type": "shape",
          "frame": {
            "x": 40,
            "y": 512,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c028",
          "type": "shape",
          "frame": {
            "x": 66,
            "y": 460,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c029",
          "type": "shape",
          "frame": {
            "x": 66,
            "y": 486,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c030",
          "type": "shape",
          "frame": {
            "x": 66,
            "y": 512,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c031",
          "type": "shape",
          "frame": {
            "x": 92,
            "y": 460,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c032",
          "type": "shape",
          "frame": {
            "x": 92,
            "y": 486,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c033",
          "type": "shape",
          "frame": {
            "x": 92,
            "y": 512,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c034",
          "type": "shape",
          "frame": {
            "x": 118,
            "y": 460,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c035",
          "type": "shape",
          "frame": {
            "x": 118,
            "y": 486,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c036",
          "type": "shape",
          "frame": {
            "x": 118,
            "y": 512,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c040",
          "type": "shape",
          "frame": {
            "x": 820,
            "y": -60,
            "w": 240,
            "h": 240,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        }
      ],
      "transition": [
        {
          "id": "skin.c063",
          "type": "shape",
          "frame": {
            "x": -120,
            "y": -100,
            "w": 520,
            "h": 520,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.7
        },
        {
          "id": "skin.c064",
          "type": "shape",
          "frame": {
            "x": 720,
            "y": 330,
            "w": 360,
            "h": 360,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.5
        }
      ],
      "end": [
        {
          "id": "skin.c128",
          "type": "shape",
          "frame": {
            "x": 60,
            "y": 60,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c129",
          "type": "shape",
          "frame": {
            "x": 60,
            "y": 86,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c130",
          "type": "shape",
          "frame": {
            "x": 86,
            "y": 60,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c131",
          "type": "shape",
          "frame": {
            "x": 86,
            "y": 86,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c132",
          "type": "shape",
          "frame": {
            "x": 112,
            "y": 60,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c133",
          "type": "shape",
          "frame": {
            "x": 112,
            "y": 86,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c150",
          "type": "shape",
          "frame": {
            "x": 870,
            "y": 440,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c151",
          "type": "shape",
          "frame": {
            "x": 870,
            "y": 466,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c152",
          "type": "shape",
          "frame": {
            "x": 896,
            "y": 440,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c153",
          "type": "shape",
          "frame": {
            "x": 896,
            "y": 466,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c154",
          "type": "shape",
          "frame": {
            "x": 922,
            "y": 440,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c155",
          "type": "shape",
          "frame": {
            "x": 922,
            "y": 466,
            "w": 10,
            "h": 10,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#BFE9D4",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        }
      ]
    }
  },
  {
    "id": "dilin-chinese",
    "name": "墨山朱印",
    "primary": "#A8322D",
    "secondary": "#E6DDCE",
    "accent": "#A8322D",
    "darkMode": "light",
    "brandPrimary": "#A8322D",
    "fontPair": {
      "heading": "Noto Serif TC",
      "body": "Noto Serif TC"
    },
    "bg": "#F4EFE6",
    "ink": {
      "heading": "#2A2622",
      "body": "#8A8178"
    },
    "decor": "堤麟原創「墨山朱印」皮肤（風格-中國風）·抽自 dilin-chinese.tw.json",
    "skinOf": "dilin-chinese",
    "layers": {
      "cover": [
        {
          "id": "skin.c002",
          "type": "shape",
          "frame": {
            "x": 520,
            "y": 0,
            "w": 80,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#F4EFE6",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        },
        {
          "id": "skin.c008",
          "type": "shape",
          "frame": {
            "x": 906,
            "y": 452,
            "w": 34,
            "h": 34,
            "rotate": 0
          },
          "shape": "roundRect",
          "fill": "#A8322D",
          "stroke": null,
          "role": "decor",
          "radius": 4
        }
      ],
      "transition": [
        {
          "id": "skin.c031",
          "type": "shape",
          "frame": {
            "x": 360,
            "y": 0,
            "w": 6,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#A8322D",
          "stroke": null,
          "role": "decor"
        }
      ]
    }
  },
  {
    "id": "dilin-education",
    "name": "晴野書山",
    "primary": "#32709F",
    "secondary": "#CFE6FA",
    "accent": "#4BA8F0",
    "darkMode": "sandwich",
    "brandPrimary": "#4BA8F0",
    "fontPair": {
      "heading": "Huninn",
      "body": "Huninn"
    },
    "bg": "#EAF6FF",
    "ink": {
      "heading": "#1F3347",
      "body": "#6A7C8E"
    },
    "darkInk": {
      "heading": "#FFFFFF",
      "body": "#FFFFFF"
    },
    "decor": "堤麟原創「晴野書山」皮肤（場景-教育培訓）·抽自 dilin-education.tw.json",
    "skinOf": "dilin-education",
    "layers": {
      "cover": [
        {
          "id": "skin.img001",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-education/img001.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.img001-mask",
          "type": "shape",
          "role": "backgroundMask",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "theme:bg",
          "stroke": null,
          "opacity": 0.55,
          "locked": true
        }
      ],
      "contents": [
        {
          "id": "skin.img006",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-education/img006.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.img006-mask",
          "type": "shape",
          "role": "backgroundMask",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "theme:bg",
          "stroke": null,
          "opacity": 0.82,
          "locked": true
        }
      ],
      "transition": [
        {
          "id": "skin.img026",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-education/img026.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c027",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 520,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#4BA8F0",
          "stroke": null,
          "role": "backgroundMask",
          "opacity": 0.55,
          "locked": true
        }
      ],
      "end": [
        {
          "id": "skin.img080",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-education/img080.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.img080-mask",
          "type": "shape",
          "role": "backgroundMask",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "theme:bg",
          "stroke": null,
          "opacity": 0.55,
          "locked": true
        }
      ]
    }
  },
  {
    "id": "dilin-fresh",
    "name": "青葉晨光",
    "primary": "#3F8F55",
    "secondary": "#F6EDC8",
    "accent": "#8CC79A",
    "darkMode": "light",
    "brandPrimary": "#3F8F55",
    "fontPair": {
      "heading": "LXGW WenKai Screen",
      "body": "Noto Sans TC"
    },
    "bg": "#FFFDF6",
    "ink": {
      "heading": "#3F8F55",
      "body": "#77857A"
    },
    "decor": "堤麟原創「青葉晨光」皮肤（風格-小清新）·抽自 dilin-fresh.tw.json",
    "skinOf": "dilin-fresh",
    "layers": {
      "cover": [
        {
          "id": "skin.img001",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 360,
            "h": 300,
            "rotate": 0
          },
          "src": "templates/slides/dilin-fresh/img001.jpg",
          "fit": "cover",
          "role": "decor"
        },
        {
          "id": "skin.img002",
          "type": "image",
          "frame": {
            "x": 700,
            "y": 290,
            "w": 300,
            "h": 272.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-fresh/img002.jpg",
          "fit": "cover",
          "role": "decor"
        }
      ],
      "contents": [
        {
          "id": "skin.img009",
          "type": "image",
          "frame": {
            "x": 760,
            "y": 0,
            "w": 240,
            "h": 220,
            "rotate": 0
          },
          "src": "templates/slides/dilin-fresh/img009.jpg",
          "fit": "cover",
          "role": "decor",
          "opacity": 0.7
        },
        {
          "id": "skin.c012",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 540,
            "w": 330,
            "h": 22.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#3F8F55",
          "stroke": null,
          "role": "decor"
        },
        {
          "id": "skin.c013",
          "type": "shape",
          "frame": {
            "x": 330,
            "y": 540,
            "w": 670,
            "h": 22.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#F6EDC8",
          "stroke": null,
          "role": "decor"
        }
      ],
      "transition": [
        {
          "id": "skin.c035",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 540,
            "w": 330,
            "h": 22.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#3F8F55",
          "stroke": null,
          "role": "decor"
        },
        {
          "id": "skin.c036",
          "type": "shape",
          "frame": {
            "x": 330,
            "y": 540,
            "w": 670,
            "h": 22.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#F6EDC8",
          "stroke": null,
          "role": "decor"
        }
      ],
      "end": [
        {
          "id": "skin.img068",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 360,
            "h": 300,
            "rotate": 0
          },
          "src": "templates/slides/dilin-fresh/img068.jpg",
          "fit": "cover",
          "role": "decor"
        },
        {
          "id": "skin.img069",
          "type": "image",
          "frame": {
            "x": 700,
            "y": 290,
            "w": 300,
            "h": 272.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-fresh/img069.jpg",
          "fit": "cover",
          "role": "decor"
        }
      ]
    }
  },
  {
    "id": "dilin-marketing",
    "name": "秋韻銀杏",
    "primary": "#E9B63B",
    "secondary": "#E6CFA0",
    "accent": "#C8452E",
    "darkMode": "light",
    "brandPrimary": "#E9B63B",
    "fontPair": {
      "heading": "Noto Serif TC",
      "body": "Noto Serif TC"
    },
    "bg": "#FFF8E7",
    "ink": {
      "heading": "#3A2E1F",
      "body": "#8A7A62"
    },
    "decor": "堤麟原創「秋韻銀杏」皮肤（場景-營銷推廣）·抽自 dilin-marketing.tw.json",
    "skinOf": "dilin-marketing",
    "layers": {
      "cover": [
        {
          "id": "skin.img001",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-marketing/img001.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.img001-mask",
          "type": "shape",
          "role": "backgroundMask",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "theme:bg",
          "stroke": null,
          "opacity": 0.82,
          "locked": true
        }
      ],
      "contents": [
        {
          "id": "skin.img006",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-marketing/img006.jpg",
          "fit": "cover",
          "role": "background",
          "opacity": 0.7,
          "locked": true
        },
        {
          "id": "skin.img006-mask",
          "type": "shape",
          "role": "backgroundMask",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "theme:bg",
          "stroke": null,
          "opacity": 0.82,
          "locked": true
        }
      ],
      "transition": [
        {
          "id": "skin.img025",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-marketing/img025.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.img025-mask",
          "type": "shape",
          "role": "backgroundMask",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "theme:bg",
          "stroke": null,
          "opacity": 0.82,
          "locked": true
        }
      ],
      "end": [
        {
          "id": "skin.img069",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-marketing/img069.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.img069-mask",
          "type": "shape",
          "role": "backgroundMask",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "theme:bg",
          "stroke": null,
          "opacity": 0.82,
          "locked": true
        }
      ]
    }
  },
  {
    "id": "dilin-medical",
    "name": "澄心湖藍",
    "primary": "#2F80ED",
    "secondary": "#BBD5F5",
    "accent": "#1FB5A6",
    "darkMode": "light",
    "brandPrimary": "#2F80ED",
    "fontPair": {
      "heading": "Noto Sans TC",
      "body": "Noto Sans TC"
    },
    "bg": "#F3F8FF",
    "ink": {
      "heading": "#1B2A3D",
      "body": "#6B7A8C"
    },
    "decor": "堤麟原創「澄心湖藍」皮肤（場景-醫療健康）·抽自 dilin-medical.tw.json",
    "skinOf": "dilin-medical",
    "layers": {
      "cover": [
        {
          "id": "skin.c001",
          "type": "shape",
          "frame": {
            "x": 560,
            "y": -60,
            "w": 520,
            "h": 680,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#2F80ED",
          "stroke": null,
          "role": "background",
          "opacity": 0.9,
          "locked": true
        }
      ],
      "contents": [
        {
          "id": "skin.c024",
          "type": "shape",
          "frame": {
            "x": -120,
            "y": 300,
            "w": 420,
            "h": 420,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#DCEBFF",
          "stroke": null,
          "role": "decor",
          "opacity": 0.7
        }
      ],
      "transition": [
        {
          "id": "skin.c059",
          "type": "shape",
          "frame": {
            "x": -160,
            "y": -80,
            "w": 620,
            "h": 720,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#1FB5A6",
          "stroke": null,
          "role": "background",
          "opacity": 0.85,
          "locked": true
        }
      ],
      "end": [
        {
          "id": "skin.c112",
          "type": "shape",
          "frame": {
            "x": 560,
            "y": -60,
            "w": 520,
            "h": 680,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#2F80ED",
          "stroke": null,
          "role": "background",
          "opacity": 0.9,
          "locked": true
        }
      ]
    }
  },
  {
    "id": "dilin-minimal",
    "name": "晴空藍",
    "primary": "#295FE2",
    "secondary": "#2F6BFF",
    "accent": "#8FB2FF",
    "darkMode": "sandwich",
    "brandPrimary": "#2F6BFF",
    "fontPair": {
      "heading": "Noto Sans TC",
      "body": "Noto Sans TC"
    },
    "bg": "#FFFFFF",
    "ink": {
      "heading": "#1F2430",
      "body": "#707784"
    },
    "darkInk": {
      "heading": "#FFFFFF",
      "body": "#DCE6FF"
    },
    "decor": "堤麟原創「晴空藍」皮肤（風格-簡約風）·抽自 dilin-minimal.tw.json",
    "skinOf": "dilin-minimal",
    "layers": {
      "cover": [
        {
          "id": "skin.c001",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 640,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#2F6BFF",
          "stroke": null,
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c002",
          "type": "shape",
          "frame": {
            "x": 470,
            "y": 300,
            "w": 420,
            "h": 420,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#8FB2FF",
          "stroke": null,
          "role": "decor",
          "opacity": 0.35
        },
        {
          "id": "skin.c003",
          "type": "shape",
          "frame": {
            "x": -120,
            "y": 380,
            "w": 260,
            "h": 260,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#FFFFFF",
          "stroke": null,
          "role": "decor",
          "opacity": 0.08
        }
      ],
      "contents": [
        {
          "id": "skin.c025",
          "type": "shape",
          "frame": {
            "x": -80,
            "y": -80,
            "w": 220,
            "h": 220,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#EEF3FF",
          "stroke": null,
          "role": "decor"
        }
      ],
      "transition": [
        {
          "id": "skin.c044",
          "type": "shape",
          "frame": {
            "x": 620,
            "y": -160,
            "w": 520,
            "h": 520,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#FFFFFF",
          "stroke": null,
          "role": "decor",
          "opacity": 0.08
        },
        {
          "id": "skin.c045",
          "type": "shape",
          "frame": {
            "x": -140,
            "y": 300,
            "w": 380,
            "h": 380,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#FFFFFF",
          "stroke": null,
          "role": "decor",
          "opacity": 0.08
        }
      ],
      "end": [
        {
          "id": "skin.c084",
          "type": "shape",
          "frame": {
            "x": 360,
            "y": 0,
            "w": 640,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#2F6BFF",
          "stroke": null,
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c085",
          "type": "shape",
          "frame": {
            "x": 700,
            "y": 260,
            "w": 420,
            "h": 420,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#8FB2FF",
          "stroke": null,
          "role": "decor",
          "opacity": 0.35
        }
      ]
    }
  },
  {
    "id": "dilin-party",
    "name": "赤綢鎏金",
    "primary": "#C8161D",
    "secondary": "#E6B8A8",
    "accent": "#F2C46D",
    "darkMode": "sandwich",
    "brandPrimary": "#C8161D",
    "fontPair": {
      "heading": "Noto Serif TC",
      "body": "Noto Sans TC"
    },
    "bg": "#FFF6E6",
    "ink": {
      "heading": "#C8161D",
      "body": "#8C6B64"
    },
    "darkInk": {
      "heading": "#FFFFFF",
      "body": "#FFFFFF"
    },
    "decor": "堤麟原創「赤綢鎏金」皮肤（風格-黨政風）·抽自 dilin-party.tw.json",
    "skinOf": "dilin-party",
    "layers": {
      "cover": [
        {
          "id": "skin.img001",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-party/img001.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.img001-mask",
          "type": "shape",
          "role": "backgroundMask",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "theme:bg",
          "stroke": null,
          "opacity": 0.55,
          "locked": true
        },
        {
          "id": "skin.img002",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 380,
            "w": 1000,
            "h": 182.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-party/img002.jpg",
          "fit": "cover",
          "role": "decor"
        }
      ],
      "contents": [
        {
          "id": "skin.img011",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 250,
            "w": 1000,
            "h": 312.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-party/img011.jpg",
          "fit": "cover",
          "role": "decor",
          "opacity": 0.7
        },
        {
          "id": "skin.c012",
          "type": "shape",
          "frame": {
            "x": -60,
            "y": 500,
            "w": 1120,
            "h": 160,
            "rotate": -3
          },
          "shape": "ellipse",
          "fill": "#C8161D",
          "stroke": null,
          "role": "decor"
        },
        {
          "id": "skin.c013",
          "type": "shape",
          "frame": {
            "x": -60,
            "y": 508,
            "w": 1120,
            "h": 12,
            "rotate": -3
          },
          "shape": "ellipse",
          "fill": "#F2C46D",
          "stroke": null,
          "role": "decor",
          "opacity": 0.9
        }
      ],
      "transition": [
        {
          "id": "skin.c033",
          "type": "shape",
          "frame": {
            "x": 480,
            "y": 0,
            "w": 520,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#C8161D",
          "stroke": null,
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c034",
          "type": "shape",
          "frame": {
            "x": 460,
            "y": 0,
            "w": 40,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#C8161D",
          "stroke": null,
          "role": "decor",
          "opacity": 0.6
        }
      ],
      "content": [
        {
          "id": "skin.c041",
          "type": "shape",
          "frame": {
            "x": -60,
            "y": 520,
            "w": 1120,
            "h": 160,
            "rotate": -3
          },
          "shape": "ellipse",
          "fill": "#C8161D",
          "stroke": null,
          "role": "decor"
        },
        {
          "id": "skin.c042",
          "type": "shape",
          "frame": {
            "x": -60,
            "y": 528,
            "w": 1120,
            "h": 12,
            "rotate": -3
          },
          "shape": "ellipse",
          "fill": "#F2C46D",
          "stroke": null,
          "role": "decor",
          "opacity": 0.9
        }
      ],
      "end": [
        {
          "id": "skin.img072",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-party/img072.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.img072-mask",
          "type": "shape",
          "role": "backgroundMask",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "theme:bg",
          "stroke": null,
          "opacity": 0.55,
          "locked": true
        },
        {
          "id": "skin.img073",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 380,
            "w": 1000,
            "h": 182.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-party/img073.jpg",
          "fit": "cover",
          "role": "decor"
        }
      ]
    }
  },
  {
    "id": "dilin-report",
    "name": "暖陽橙",
    "primary": "#945F13",
    "secondary": "#FDE6C2",
    "accent": "#F29A1F",
    "darkMode": "sandwich",
    "brandPrimary": "#F29A1F",
    "fontPair": {
      "heading": "Noto Sans TC",
      "body": "Noto Sans TC"
    },
    "bg": "#FFFFFF",
    "ink": {
      "heading": "#2B2622",
      "body": "#7C746C"
    },
    "darkInk": {
      "heading": "#FFFFFF",
      "body": "#FFF1D6"
    },
    "decor": "堤麟原創「暖陽橙」皮肤（場景-總結匯報）·抽自 dilin-report.tw.json",
    "skinOf": "dilin-report",
    "layers": {
      "cover": [
        {
          "id": "skin.c002",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 560,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#F29A1F",
          "stroke": null,
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c003",
          "type": "shape",
          "frame": {
            "x": 500,
            "y": 0,
            "w": 120,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#F29A1F",
          "stroke": null,
          "role": "decor",
          "opacity": 0.55
        },
        {
          "id": "skin.c004",
          "type": "shape",
          "frame": {
            "x": -200,
            "y": 440,
            "w": 900,
            "h": 240,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#FFF7EA",
          "stroke": null,
          "role": "decor",
          "opacity": 1
        },
        {
          "id": "skin.c005",
          "type": "shape",
          "frame": {
            "x": 420,
            "y": 480,
            "w": 900,
            "h": 260,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#FFF7EA",
          "stroke": null,
          "role": "decor",
          "opacity": 1
        }
      ],
      "transition": [
        {
          "id": "skin.img029",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-report/img029.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c030",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#F29A1F",
          "stroke": null,
          "role": "backgroundMask",
          "opacity": 0.78,
          "locked": true
        },
        {
          "id": "skin.c031",
          "type": "shape",
          "frame": {
            "x": -200,
            "y": 440,
            "w": 900,
            "h": 240,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#FFF7EA",
          "stroke": null,
          "role": "decor",
          "opacity": 1
        },
        {
          "id": "skin.c032",
          "type": "shape",
          "frame": {
            "x": 420,
            "y": 480,
            "w": 900,
            "h": 260,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#FFF7EA",
          "stroke": null,
          "role": "decor",
          "opacity": 1
        }
      ],
      "end": [
        {
          "id": "skin.c066",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 600,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#F29A1F",
          "stroke": null,
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c067",
          "type": "shape",
          "frame": {
            "x": -200,
            "y": 460,
            "w": 900,
            "h": 240,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#FFF7EA",
          "stroke": null,
          "role": "decor",
          "opacity": 1
        },
        {
          "id": "skin.c068",
          "type": "shape",
          "frame": {
            "x": 420,
            "y": 500,
            "w": 900,
            "h": 260,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#FFF7EA",
          "stroke": null,
          "role": "decor",
          "opacity": 1
        }
      ]
    }
  },
  {
    "id": "dilin-tech",
    "name": "深空流光",
    "primary": "#070F24",
    "secondary": "#7C5CFF",
    "accent": "#22D3EE",
    "darkMode": "all-dark",
    "brandPrimary": "#070F24",
    "fontPair": {
      "heading": "Noto Sans TC",
      "body": "Noto Sans TC"
    },
    "darkInk": {
      "heading": "#EAF2FF",
      "body": "#8FA3C7"
    },
    "decor": "堤麟原創「深空流光」皮肤（風格-科技風）·抽自 dilin-tech.tw.json",
    "skinOf": "dilin-tech",
    "layers": {
      "cover": [
        {
          "id": "skin.img001",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-tech/img001.jpg",
          "fit": "cover",
          "role": "background",
          "locked": true
        },
        {
          "id": "skin.c002",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 560,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#070F24",
          "stroke": null,
          "role": "backgroundMask",
          "opacity": 0.72,
          "locked": true
        }
      ],
      "contents": [
        {
          "id": "skin.c010",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#070F24",
          "stroke": null,
          "role": "decor"
        }
      ],
      "transition": [
        {
          "id": "skin.c062",
          "type": "shape",
          "frame": {
            "x": 560,
            "y": 60,
            "w": 440,
            "h": 440,
            "rotate": 0
          },
          "shape": "ellipse",
          "fill": "#7C5CFF",
          "stroke": null,
          "role": "decor",
          "opacity": 0.35
        }
      ],
      "end": [
        {
          "id": "skin.img105",
          "type": "image",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "src": "templates/slides/dilin-tech/img105.jpg",
          "fit": "cover",
          "role": "background",
          "opacity": 0.6,
          "locked": true
        },
        {
          "id": "skin.c106",
          "type": "shape",
          "frame": {
            "x": 0,
            "y": 0,
            "w": 1000,
            "h": 562.5,
            "rotate": 0
          },
          "shape": "rect",
          "fill": "#070F24",
          "stroke": null,
          "role": "backgroundMask",
          "opacity": 0.4,
          "locked": true
        }
      ]
    }
  }
] as unknown as readonly DilinSkin[]
