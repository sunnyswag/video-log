/* Kotlin 实现 SIP 通信协议｜扁平 MG 风格包与完整 29 幕。
 * 所有画面文字、字幕和 cue 集中在本文件；时间只取自参数，不读时钟、不积累帧状态。
 * 图元坐标默认取中心；drawItems 按 zIndex 排序，其余图元按调用顺序叠放。
 */
(function (root) {
'use strict';
const { TAU, clamp, lerp, seg, eo, eio, rgba } = FilmKit;
const W = 1920, H = 1080, FPS = 30;
const theme = Object.freeze({
  bg: '#F6F1E7', ink: '#252936', paper: '#FFFFFF', blue: '#245CC5',
  coral: '#C8474C', amber: '#A66009', green: '#198565', purple: '#7956B3',
});
const C = theme;
const fonts = Object.freeze({ cjk: '"FCJK","FSup"', disp: '"FDisp","FCJK"', mono: '"FMono","FMonoCJK"' });
const fontsNeeded = [
  ...[500,700,900].map(w => `${w} 32px "FCJK"`),
  ...[800,900].map(w => `${w} 32px "FDisp"`),
  ...[500,700,900].map(w => `${w} 32px "FSup"`),
  ...[400,700].flatMap(w => [`${w} 32px "FMono"`, `${w} 32px "FMonoCJK"`]),
];
const UI = { title: 'Kotlin 实现 SIP 通信协议', play: '播放', pause: '暂停', hint: '空格 播放/暂停 · ←/→ 跳 5 秒 · 声音请看成片 mp4', fontProbe: '时间0aA⁰¹' };
const SERIES = { title: '工作档案', sub: '把做过的设计，讲成故事', next: '' };
const CHAPTERS = [
  ['开场｜取消去哪了', 'WHERE DID CANCEL GO', '按机制构造的两端不一致：取消消息悬在创建窗口外。'],
  ['Kotlin 实现 SIP 通信协议', 'A SIP-STYLE PROTOCOL IN KOTLIN', '先排队，再开口。'],
  ['第一章｜接通，原来这么麻烦', 'THE CALL BEGINS', '邀请、响铃、接听和确认；两块屏靠消息对齐各自的状态。'],
  ['第二章｜取消，掉进了缝里', 'THE CREATION GAP', '约 50 ms 创建窗口里，构造的取消先到，因会话未匹配而忽略。'],
  ['第三章｜状态机，背不了这锅', 'BEFORE THE STATE MACHINE', '会话匹配在状态转移之前；响铃超时只能兜底。'],
  ['第四章｜先排队，别抢跑', 'ONE AT A TIME', '同一条本地处理链逐项完成，会话创建必须包含在本次处理内。'],
  ['第五章｜这回，终于接住了', 'CANCEL FINALLY ARRIVES', '重放同一构造案例：创建完成后再处理取消；两端仍各管各的状态。'],
  ['总结｜这次记住四件事', 'KEEP THE FOUR RULES', '先认会话、排完整过程、状态机管规则、超时留退路。'],
  ['结尾｜把那条取消接住', 'LET IT FINISH', '无需虚构创建变快，让完整处理先做完。'],
  ['系列片尾', 'WORK ARCHIVE', '工作档案：把做过的设计，讲成故事。'],
];
const MSG = Object.freeze({
  invite: { code: '101', name: 'INVITE', tone: 'blue' }, ring: { code: '102', name: 'RING', tone: 'blue' },
  accept: { code: '200', name: 'ACCEPT', tone: 'green' }, confirm: { code: '201', name: 'PREPARE_CONFIRM', tone: 'green' },
  terminate: { code: '402', name: 'TERMINATE_END', tone: 'coral' }, timeout: { code: '404', name: 'TIMEOUT_END', tone: 'purple' },
});
const T = Object.freeze({ a: [340,335], gateway: [960,335], b: [1580,335],
  outgoing: [[340,585],[960,615],[1580,645]], incoming: [[1580,710],[960,750],[340,790]],
});
// 与绘制函数分开；替换字幕不必碰图元。end 保留原稿的精确停留区间。
const SCRIPT = {
  "s01": {
    "dur": 15,
    "chapter": 0,
    "name": "取消去哪了",
    "captions": [
      {
        "t": 0.0,
        "end": 3.6,
        "text": "我这边，已经{取消}了"
      },
      {
        "t": 3.6,
        "end": 7.2,
        "text": "对面，怎么[还在响]"
      },
      {
        "t": 7.2,
        "end": 11.0,
        "text": "问题藏在^约50毫秒^里"
      },
      {
        "t": 11.0,
        "end": 15.0,
        "text": "那条{取消消息}，去哪了"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "ring"
      },
      {
        "t": 3.6,
        "type": "error"
      },
      {
        "t": 4,
        "type": "ring"
      },
      {
        "t": 14.7,
        "type": "whoosh"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s02": {
    "dur": 7,
    "chapter": 1,
    "name": "片名落下",
    "captions": [
      {
        "t": 0.0,
        "end": 4.8,
        "text": "Kotlin 实现 SIP 通信协议"
      },
      {
        "t": 4.8,
        "end": 7.0,
        "text": "先排队，再开口"
      }
    ],
    "cues": [
      {
        "t": 0,
        "type": "whoosh"
      }
    ],
    "title": true
  },
  "s03": {
    "dur": 12,
    "chapter": 2,
    "name": "先交代这条路",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "工作上，要做一个{语音通话}"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "数据走{网关}，它替代了{代理服务器}"
      },
      {
        "t": 8.0,
        "end": 12.0,
        "text": "通话怎么建立，得{自己实现}"
      }
    ],
    "cues": [
      {
        "t": 4,
        "type": "send"
      }
    ]
  },
  "s04": {
    "dur": 13,
    "chapter": 2,
    "name": "邀请要有回声",
    "captions": [
      {
        "t": 0.0,
        "end": 4.2,
        "text": "我先发出一条{邀请}"
      },
      {
        "t": 4.2,
        "end": 8.6,
        "text": "对面回一句：{我开始响铃了}"
      },
      {
        "t": 8.6,
        "end": 13.0,
        "text": "收到回音，我就{停止重发}"
      }
    ],
    "cues": [
      {
        "t": 1,
        "type": "send"
      },
      {
        "t": 4,
        "type": "ring"
      },
      {
        "t": 4.4,
        "type": "send"
      }
    ]
  },
  "s05": {
    "dur": 14,
    "chapter": 2,
    "name": "点接听，还没全接上",
    "captions": [
      {
        "t": 0.0,
        "end": 4.4,
        "text": "对面点了{接听}"
      },
      {
        "t": 4.4,
        "end": 9.0,
        "text": "我收到消息，先进入{通话}"
      },
      {
        "t": 9.0,
        "end": 14.0,
        "text": "可对面，还在{准备状态}"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "latch"
      },
      {
        "t": 3.2,
        "type": "send"
      }
    ]
  },
  "s06": {
    "dur": 13,
    "chapter": 2,
    "name": "最后一句，我收到了",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "还差最后一条{确认}"
      },
      {
        "t": 4.0,
        "end": 8.4,
        "text": "对面收到，才进入{通话}"
      },
      {
        "t": 8.4,
        "end": 13.0,
        "text": "两边的状态，靠{消息}对齐"
      }
    ],
    "cues": [
      {
        "t": 0.3,
        "type": "send"
      },
      {
        "t": 1.5,
        "type": "success"
      }
    ]
  },
  "s07": {
    "dur": 12,
    "chapter": 3,
    "name": "把取消放到更早",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "接通的路，先看到这里"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "如果{取消}来得更早呢"
      },
      {
        "t": 8.0,
        "end": 12.0,
        "text": "就在被叫{创建会话}的时候"
      }
    ],
    "cues": [
      {
        "t": 0,
        "type": "whoosh"
      },
      {
        "t": 2.8,
        "type": "send"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s08": {
    "dur": 14,
    "chapter": 3,
    "name": "这道缝，大概五十毫秒",
    "captions": [
      {
        "t": 0.0,
        "end": 4.6,
        "text": "创建会话，大概需要^50毫秒^"
      },
      {
        "t": 4.6,
        "end": 9.2,
        "text": "偏偏这时候，{取消}先到了"
      },
      {
        "t": 9.2,
        "end": 14.0,
        "text": "消息到了，会话还[没建好]"
      }
    ],
    "cues": [
      {
        "t": 4.6,
        "type": "send"
      },
      {
        "t": 9.2,
        "type": "error"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s09": {
    "dur": 14,
    "chapter": 3,
    "name": "到了，也可能没人接",
    "captions": [
      {
        "t": 0.0,
        "end": 4.6,
        "text": "它得先找到{自己的会话}"
      },
      {
        "t": 4.6,
        "end": 9.2,
        "text": "找不到，又不是{邀请}"
      },
      {
        "t": 9.2,
        "end": 14.0,
        "text": "于是，只留下了一条[日志]"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "send"
      },
      {
        "t": 9.2,
        "type": "error"
      }
    ],
    "demo": true
  },
  "s10": {
    "dur": 14,
    "chapter": 3,
    "name": "它建好了，可取消没了",
    "captions": [
      {
        "t": 0.0,
        "end": 4.6,
        "text": "会话终于建好了"
      },
      {
        "t": 4.6,
        "end": 9.2,
        "text": "它开始{响铃}，取消却没了"
      },
      {
        "t": 9.2,
        "end": 14.0,
        "text": "我结束了，对面还在[等接听]"
      }
    ],
    "cues": [
      {
        "t": 0.8,
        "type": "ring"
      },
      {
        "t": 1,
        "type": "send"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s11": {
    "dur": 12,
    "chapter": 4,
    "name": "先过会话这一关",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "消息不是直接丢给{状态机}"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "先用{会话标识}，找到归属"
      },
      {
        "t": 8.0,
        "end": 12.0,
        "text": "匹配上，才轮到{状态转移}"
      }
    ],
    "cues": [
      {
        "t": 4,
        "type": "latch"
      }
    ]
  },
  "s12": {
    "dur": 12,
    "chapter": 4,
    "name": "规则其实在这里",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "状态机知道{怎么结束}"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "被叫收到取消，就能{结束}"
      },
      {
        "t": 8.0,
        "end": 12.0,
        "text": "可刚才，消息根本[没进来]"
      }
    ],
    "cues": [
      {
        "t": 1.2,
        "type": "latch"
      },
      {
        "t": 5.2,
        "type": "success"
      }
    ],
    "demoAt": 8
  },
  "s13": {
    "dur": 12,
    "chapter": 4,
    "name": "出事的是先后顺序",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "坑在{创建}和{处理}之间"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "上一件还没做完，下一件就来了"
      },
      {
        "t": 8.0,
        "end": 12.0,
        "text": "先后顺序，被[并发]打乱了"
      }
    ],
    "cues": [
      {
        "t": 4,
        "type": "error"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s14": {
    "dur": 12,
    "chapter": 4,
    "name": "等一分钟，才算结束",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "最后，还有^60秒^兜底"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "到点，本地产生{超时消息}"
      },
      {
        "t": 8.0,
        "end": 12.0,
        "text": "但这救不了[丢掉的取消]"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "tick"
      },
      {
        "t": 3.8,
        "type": "tick"
      },
      {
        "t": 4,
        "type": "send"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s15": {
    "dur": 14,
    "chapter": 5,
    "name": "这回先把队排好",
    "captions": [
      {
        "t": 0.0,
        "end": 3.6,
        "text": "我需要让处理过程{排队}"
      },
      {
        "t": 3.6,
        "end": 7.0,
        "text": "候选有{加锁}、{同步屏障}、{Flow}"
      },
      {
        "t": 7.0,
        "end": 10.4,
        "text": "最后，我选了{Flow}"
      },
      {
        "t": 10.4,
        "end": 14.0,
        "text": "理由很朴素：{好懂，好维护}"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "whoosh"
      },
      {
        "t": 7,
        "type": "latch"
      }
    ]
  },
  "s16": {
    "dur": 14,
    "chapter": 5,
    "name": "这一个做完，再取下一个",
    "captions": [
      {
        "t": 0.0,
        "end": 3.6,
        "text": "消息先进入{同一条队列}"
      },
      {
        "t": 3.6,
        "end": 7.0,
        "text": "前一个{做完}，才取下一个"
      },
      {
        "t": 7.0,
        "end": 10.4,
        "text": "创建会话，也算这一步"
      },
      {
        "t": 10.4,
        "end": 14.0,
        "text": "这样，取消就不会{抢跑}"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "tick"
      },
      {
        "t": 0.8,
        "type": "tick"
      },
      {
        "t": 2,
        "type": "latch"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s17": {
    "dur": 14,
    "chapter": 5,
    "name": "把完成边界写出来",
    "captions": [
      {
        "t": 0.0,
        "end": 4.6,
        "text": "关键，是这一步{处理完成}"
      },
      {
        "t": 4.6,
        "end": 9.2,
        "text": "会话建好，才结束本次处理"
      },
      {
        "t": 9.2,
        "end": 14.0,
        "text": "下一条消息，再交给会话"
      }
    ],
    "cues": [
      {
        "t": 4.6,
        "type": "latch"
      }
    ]
  },
  "s18": {
    "dur": 14,
    "chapter": 5,
    "name": "排队，别只排个开头",
    "captions": [
      {
        "t": 0.0,
        "end": 3.6,
        "text": "注意，我说的是{处理完}"
      },
      {
        "t": 3.6,
        "end": 7.0,
        "text": "只把启动动作排队，[不够]"
      },
      {
        "t": 7.0,
        "end": 10.4,
        "text": "活儿没做完，坑就还在"
      },
      {
        "t": 10.4,
        "end": 14.0,
        "text": "队列要等到{会话可用了}"
      }
    ],
    "cues": [
      {
        "t": 3.6,
        "type": "error"
      },
      {
        "t": 12,
        "type": "latch"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s19": {
    "dur": 12,
    "chapter": 6,
    "name": "同一条邀请，再来一遍",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "现在，把那两条消息{再放一遍}"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "邀请先到，开始{创建会话}"
      },
      {
        "t": 8.0,
        "end": 12.0,
        "text": "这一步结束前，{不取下一条}"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "send"
      },
      {
        "t": 2.6,
        "type": "latch"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s20": {
    "dur": 12,
    "chapter": 6,
    "name": "这回先等在外面",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "取消，还是{提前到了}"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "这回，它被{留在队列里}"
      },
      {
        "t": 8.0,
        "end": 12.0,
        "text": "它没有撞上[半成品会话]"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "latch"
      },
      {
        "t": 0.6,
        "type": "send"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s21": {
    "dur": 13,
    "chapter": 6,
    "name": "终于轮到取消",
    "captions": [
      {
        "t": 0.0,
        "end": 4.2,
        "text": "会话建好，先进入{响铃}"
      },
      {
        "t": 4.2,
        "end": 8.6,
        "text": "再取取消，这次{找得到会话}"
      },
      {
        "t": 8.6,
        "end": 13.0,
        "text": "于是，立刻{结束这次呼叫}"
      }
    ],
    "cues": [
      {
        "t": 1,
        "type": "ring"
      },
      {
        "t": 1,
        "type": "send"
      },
      {
        "t": 4.2,
        "type": "latch"
      },
      {
        "t": 8.6,
        "type": "success"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s22": {
    "dur": 13,
    "chapter": 6,
    "name": "终于对上了",
    "captions": [
      {
        "t": 0.0,
        "end": 4.2,
        "text": "我取消了，你也{结束了}"
      },
      {
        "t": 4.2,
        "end": 8.6,
        "text": "状态名不同，结果终于{对上了}"
      },
      {
        "t": 8.6,
        "end": 13.0,
        "text": "补上的，是{本地处理顺序}"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "success"
      },
      {
        "t": 8.6,
        "type": "tick"
      },
      {
        "t": 9.3,
        "type": "tick"
      },
      {
        "t": 10,
        "type": "tick"
      }
    ],
    "demo": true
  },
  "s23": {
    "dur": 12,
    "chapter": 6,
    "name": "各排各的，别画成一条",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "被叫收消息，要{按顺序处理}"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "主叫建会话，也要{串行化}"
      },
      {
        "t": 8.0,
        "end": 12.0,
        "text": "两块屏，仍是{各管各的状态}"
      }
    ],
    "cues": [
      {
        "t": 4,
        "type": "latch"
      }
    ]
  },
  "s24": {
    "dur": 8,
    "chapter": 7,
    "name": "记住一：先有归属",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "先确认：消息{属于哪个会话}"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "会话还没好，消息就[可能丢]"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "latch"
      }
    ]
  },
  "s25": {
    "dur": 8,
    "chapter": 7,
    "name": "记住二：等完整做完",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "要排队的，是{完整处理过程}"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "处理完一条，再处理下一条"
      }
    ],
    "cues": [
      {
        "t": 4,
        "type": "latch"
      }
    ]
  },
  "s26": {
    "dur": 8,
    "chapter": 7,
    "name": "记住三：规则也需要入口",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "状态机定义{收到后怎么办}"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "顺序对了，规则才有机会生效"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "send"
      },
      {
        "t": 4.8,
        "type": "success"
      }
    ]
  },
  "s27": {
    "dur": 8,
    "chapter": 7,
    "name": "记住四：兜底不能当修复",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "每条等待，都要有{退出办法}"
      },
      {
        "t": 4.0,
        "end": 8.0,
        "text": "超时能兜底，{不能代替正确顺序}"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "tick"
      },
      {
        "t": 4,
        "type": "latch"
      }
    ]
  },
  "s28": {
    "dur": 10,
    "chapter": 8,
    "name": "那条取消，有人接住了",
    "captions": [
      {
        "t": 0.0,
        "end": 4.0,
        "text": "那条{取消}，这回有人接住了"
      },
      {
        "t": 4.0,
        "end": 7.2,
        "text": "这^约50毫秒^，不用变快"
      },
      {
        "t": 7.2,
        "end": 10.0,
        "text": "只要让它{做完}"
      }
    ],
    "cues": [
      {
        "t": 0.4,
        "type": "success"
      },
      {
        "t": 7.2,
        "type": "latch"
      }
    ],
    "demo": true,
    "scaled": true
  },
  "s29": {
    "dur": 2,
    "chapter": 9,
    "name": "系列片尾",
    "captions": [
      {
        "t": 0.0,
        "end": 2.0,
        "text": "{系列片尾}"
      }
    ],
    "cues": [],
    "title": true
  }
};
SCRIPT.s29.captions[0].text = SERIES.title;
// 全片唯一允许的上屏代码；仅在第 17 幕绘制。
const CODE = [
  'controls.collect { packet ->',
  '    if (isNewInvite(packet)) {',
  '        createCalleeAndWait(packet)',
  '    } else {',
  '        routeBySession(packet)',
  '    }',
  '}',
];
const film = FilmKit.create({
  W, H, FPS, fonts, fontsNeeded,
  theme: { ...C, white: C.ink, cyan: C.blue, red: C.coral, amber: C.amber, pink: C.purple,
    code: C.ink, comment: C.purple, punct: C.ink, constant: C.amber },
  code: { keywords: ['if','else'], types: [] },
  captions: { font: { f: 'cjk', s: 60, w: 700 }, colors: { emphasis: C.blue, danger: C.coral, accent: C.amber },
    maxWidth: 1580, lineHeight: 68, baseY: n => n > 1 ? 925 : 969, slide: 0, fadeIn: .1, fadeOut: .1, revealDuration: () => 0 },
  prepare: prepareStyle, drawBackground, beforeScene, drawChrome, drawCaptionBackground, drawCaption, drawCover,
});
const { txt, tw } = film;
const tone = name => C[name] || name || C.blue;
function tint(c, p = .12) { // 与白色混合，派生浅底不引入新的主题色。
  const n = parseInt(c.slice(1),16), a = [n>>16,(n>>8)&255,n&255];
  return '#' + a.map(v => Math.round(lerp(255,v,p)).toString(16).padStart(2,'0')).join('');
}

/* ---------------- 基础形状与公共参数 ---------------- */
function rr(g,x,y,w,h,r=24) { g.beginPath(); g.roundRect(x,y,w,h,Math.min(r,w/2,h/2)); }
function panel(g,x,y,w,h,o={}) {
  g.save();
  if (o.shadow) { rr(g,x+6,y+7,w,h,o.r); g.fillStyle=C.ink; g.fill(); }
  rr(g,x,y,w,h,o.r); g.fillStyle=o.fill||C.paper; g.fill();
  if (o.dashed) g.setLineDash([10,9]);
  g.strokeStyle=o.stroke||C.ink; g.lineWidth=o.lw??4; if (g.lineWidth) g.stroke(); g.restore();
}
function line(g,points,o={}) {
  if (points.length<2) return;
  g.save(); g.strokeStyle=o.c||C.ink; g.lineWidth=o.w||4; g.lineCap='round'; g.lineJoin='round';
  if(o.dashed) g.setLineDash([10,12]);
  g.beginPath(); points.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y)); g.stroke(); g.restore();
}
function dot(g,x,y,r,c) { g.beginPath(); g.arc(x,y,r,0,TAU); g.fillStyle=c; g.fill(); }
function label(g,s,x,y,o={}) { txt(g,s,x,y,{s:32,w:700,c:C.ink,a:'center',...o}); }
// Caption-like opaque backing for labels on connectors; use after lines, before the main captions.
function tag(g,s,x,y,o={}) {
  const style={s:28,w:700,a:'center',...o},w=tw(g,s,style)+32,h=style.s+24;
  const left=style.a==='left'?x-16:style.a==='right'?x-w+16:x-w/2;
  panel(g,left,y-style.s-9,w,h,{fill:o.fill||C.bg,lw:0,r:12}); label(g,s,x,y,style);
}
function boxText(g,s,x,y,w=300,h=86,o={}) {
  panel(g,x-w/2,y-h/2,w,h,{fill:o.fill||C.paper,stroke:o.stroke||C.ink,shadow:o.shadow,r:20});
  const {fill,stroke,shadow,...textStyle}=o;label(g,s,x,y+12,{s:32,...textStyle});
}
function fade(g,a,fn) { g.save();g.globalAlpha*=clamp(a);try{fn();}finally{g.restore();} }

function item(g,t,o,w,h,draw) {
  const a=(o.opacity??1)*(o.enterAt==null?1:eo(seg(t,o.enterAt,o.enterAt+.3)))*(o.exitAt==null?1:1-seg(t,o.exitAt,o.exitAt+.3));
  if(a<=0) return;
  g.save(); g.globalAlpha*=a; g.translate(o.x??0,o.y??0);
  g.scale((o.scale??1)*(o.width??w)/w,(o.scale??1)*(o.height??h)/h);
  try { draw(); } finally { g.restore(); }
}
function drawItems(g,t,items) { items.map((a,i)=>({...a,i})).sort((a,b)=>(a.zIndex||0)-(b.zIndex||0)||a.i-b.i).forEach(o=>o.draw(g,t,o)); }
function arrow(g,t,o={}) {
  const pts=o.points||[[0,0],[100,0]], p=clamp(o.reveal??1); if(p<=0)return;
  const q=pathAt(pts,p), index=Math.min(pts.length-2,Math.floor(p*(pts.length-1))), part=pts.slice(0,index+1).concat([[q.x,q.y]]);
  item(g,t,o,W,H,()=>{line(g,part,{c:tone(o.tone||'ink'),w:o.lineWidth||4,dashed:o.dashed});
  if(!o.blocked) { const prev=pts[index], a=Math.atan2(q.y-prev[1],q.x-prev[0]);
    line(g,[[q.x-14*Math.cos(a-.52),q.y-14*Math.sin(a-.52)],[q.x,q.y],[q.x-14*Math.cos(a+.52),q.y-14*Math.sin(a+.52)]],{c:tone(o.tone||'ink'),w:o.lineWidth||4}); }
  if(o.label) tag(g,o.label,o.labelX??q.x,o.labelY??q.y-25,{s:28});});
}
// 每个控制点之间独立缓动；中点和到达时刻固定，弹性只改变胶囊姿态，不让消息越过接收端。
function pathAt(points,p) { const n=points.length-1,k=clamp(p)*n,i=Math.min(n-1,Math.floor(k)),f=k-i;
  return {x:lerp(points[i][0],points[i+1][0],f),y:lerp(points[i][1],points[i+1][1],f)}; }
function easedPath(points,p) { const n=points.length-1,k=clamp(p)*n,i=Math.min(n-1,Math.floor(k)); return pathAt(points,(i+eio(k-i))/n); }
function symbol(g,t,o={}) {
  item(g,t,o,64,64,()=>{ const c=tone(o.tone||'green');
    if(o.kind==='check') line(g,[[-22,0],[-6,17],[25,-20]],{c,w:7});
    else if(o.kind==='cross') { line(g,[[-18,-18],[18,18]],{c,w:7}); line(g,[[18,-18],[-18,18]],{c,w:7}); }
    else if(o.kind==='warning') { line(g,[[0,-27],[29,24],[-29,24],[0,-27]],{c,w:4});line(g,[[0,-10],[0,5]],{c,w:4});dot(g,0,15,2.5,c); }
    else label(g,'?',0,23,{f:'disp',s:64,c});
  });
}

/* ---------------- 角色、状态与传输 ---------------- */
function actionButton(g,t,o={}) {
  item(g,t,o,80,80,()=>{ const dt=t-(o.pressedAt??-10),s=dt>=0&&dt<.24?1-.1*Math.sin(Math.PI*dt/.24):1;
    g.scale(s,s); dot(g,0,0,38,tint(tone(o.tone||'blue'))); g.strokeStyle=C.ink;g.lineWidth=4;g.stroke();
    if(o.action==='cancel') symbol(g,t,{kind:'cross',tone:'coral',scale:.52});
    else { line(g,[[-16,-8],[-12,6],[0,15],[12,6],[16,-8]],{w:6}); line(g,[[-19,-9],[-10,-12]],{w:7});line(g,[[10,-12],[19,-9]],{w:7}); }
  });
}
function bell(g,t,o={}) {
  item(g,t,o,220,140,()=>{ const amp=o.amplitude??1;
    for(const side of [-1,1]) for(let i=0;i<2;i++) { g.save();g.globalAlpha*=.65+.35*amp;g.strokeStyle=C.amber;g.lineWidth=5;g.lineCap='round';
      g.beginPath();const r=24+i*20+amp*6,a=side>0?0:Math.PI;g.arc(side*110,0,r,a-.62,a+.62);g.stroke();g.restore(); }
  });
}
function screen(g,t,o={}) {
  item(g,t,o,220,140,()=>{ const c=o.role==='B'?C.amber:C.blue;
    panel(g,-110,-70,220,140,{fill:tint(c,.2),shadow:true,r:24}); panel(g,-94,-53,188,105,{fill:C.paper,lw:3,r:17});
    dot(g,0,-61,3,C.ink); label(g,o.uiText||'',0,0,{s:26,w:900});
    line(g,[[-23,64],[23,64]],{w:3});
    if(o.roleLabel!==false) label(g,o.role==='B'?'被叫屏 B':'主叫屏 A',0,-94,{s:28,c});
    if(o.button) actionButton(g,t,{y:31,scale:.38,action:o.button,pressedAt:o.pressedAt});
    else { line(g,[[-33,28],[33,28]],{w:7,c:tint(c,.35)});dot(g,44,28,4,c); }
    if(o.ringing) bell(g,t,{amplitude:o.ringAt==null?.4:(t>=o.ringAt&&t<o.ringAt+.5?Math.sin(seg(t,o.ringAt,o.ringAt+.5)*Math.PI):0)});
  });
}
function gateway(g,t,o={}) {
  item(g,t,o,150,100,()=>{ line(g,[[-48,-36],[-60,-78]],{w:6});line(g,[[48,-36],[60,-78]],{w:6});
    dot(g,-60,-80,5,C.purple);dot(g,60,-80,5,C.purple); panel(g,-75,-44,150,88,{fill:tint(C.purple,.26),shadow:true,r:22});
    for(let i=0;i<3;i++)panel(g,-41+i*29,-6,15,15,{fill:o.active&&i===1?C.green:C.paper,r:4,lw:2});
    if(o.label!==false)label(g,'网关',0,-102,{s:28,c:C.purple});
  });
}
function stateLabel(g,t,o={}) {
  const ended=(o.state||'').startsWith('ENDED.'),w=o.width??(ended?440:320),h=o.height??(ended?92:64);
  item(g,t,{...o,width:w,height:h},w,h,()=>{
    const c=tone(o.tone||'blue');panel(g,-w/2,-h/2,w,h,{fill:tint(c,.08),stroke:o.emphasis?c:C.ink,r:18,lw:o.emphasis?6:4});
    const parts=ended?['ENDED.',o.state.slice(6)]:[o.state||'IDLE'];
    parts.forEach((v,i)=>label(g,v,0,parts.length===1?10:-10+i*(o.lineHeight||38),{f:'mono',s:o.fontSize||28,c}));
  });
}

function message(g,t,o={}) {
  const c=tone(o.tone||'blue'),stacked=!!o.sid||!!o.compact,name=o.name||'',size=stacked?28:30;
  const w=o.width??Math.max(stacked?300:260,tw(g,name,{f:'mono',s:size,w:700})+(stacked?36:122)),h=stacked?96:68;
  item(g,t,{...o,width:w,height:h},w,h,()=>{panel(g,-w/2,-h/2,w,h,{fill:o.outlined?C.paper:tint(c,.14),stroke:c,r:20,shadow:o.shadow??true});
    if(stacked){label(g,String(o.code||''),-w/2+20,-9,{a:'left',f:'mono',s:28,c});label(g,o.sid||'',w/2-20,-9,{a:'right',f:'mono',s:28,c});label(g,name,0,29,{f:'mono',s:28});}
    else {line(g,[[-w/2+74,-23],[-w/2+74,23]],{c,w:3});label(g,String(o.code||''),-w/2+37,11,{f:'mono',s:30,c});label(g,name,-w/2+94,11,{a:'left',f:'mono',s:30});}
  });
}

function flight(g,t,o={}) {
  const start=o.start??0,end=o.end??start+1.2,hold=o.hold??.45;
  if(t<start||t>=end+hold)return;
  const p=seg(t,start,end),pos=pathAt(o.points,p),dt=Math.max(0,t-end),landing=dt<.4?.07*Math.sin(dt/.4*TAU)*Math.exp(-dt*8):0;
  const bob=p<1?Math.sin(p*Math.PI*4)*3*Math.sin(p*Math.PI):0;
  // Keep the backing opaque on the route; fading it reveals the connector
  // through the letters. The capsule is removed when its existing hold ends.
  message(g,t,{...o,x:pos.x+(o.x??0),y:pos.y+bob+(o.y??0),scale:(o.scale??1)*(1+landing),opacity:o.opacity??1});
}
function lanes(g,t,o={}) {
  for(const x of [340,960,1580])arrow(g,t,{points:[[x,559],[x,836]],opacity:.18,reveal:o.reveal??1,lineWidth:3});
  tag(g,'时间',1780,790,{s:24});arrow(g,t,{points:[[1780,806],[1780,836]],lineWidth:3});
}

function stateNode(g,t,o={}) {
  const w=o.width??440,h=o.height??110;
  item(g,t,{...o,width:w,height:h},w,h,()=>{const c=tone(o.tone||'blue');
    panel(g,-w/2,-h/2,w,h,{fill:o.current?tint(c,.14):C.bg});
    if(o.current)panel(g,-w/2+7,-h/2+7,w-14,h-14,{fill:tint(c,.14),stroke:c,r:18,lw:3});
    const names=(o.label||'IDLE').replace('ENDED.','ENDED.\n').split('\n');
    names.forEach((v,i)=>label(g,v,0,names.length===1?11:-10+i*38,{f:o.generic?'cjk':'mono',s:o.fontSize||28}));
  });
}

function stateArrow(g,t,o={}) { arrow(g,t,{...o,reveal:o.reveal??1,lineWidth:5}); }
function retry(g,t,o={}) {
  item(g,t,o,72,72,()=>{g.rotate(o.running?t*1.8:0);g.strokeStyle=C.blue;g.lineWidth=5;g.lineCap='round';g.beginPath();g.arc(0,0,27,.4,TAU-.5);g.stroke();
    line(g,[[14,-27],[26,-14],[9,-10]],{w:5,c:C.blue});});
}

/* ---------------- 会话、计时、队列与卡片 ---------------- */
function boundary(g,t,o={}) {
  const w=o.width??1720,h=o.height??640;
  item(g,t,{...o,width:w,height:h},w,h,()=>{panel(g,-w/2,-h/2,w,h,{fill:o.fill||tint(C.purple,.035),dashed:true,stroke:tint(C.ink,.5)});
    if(o.title!==false)label(g,o.title||'B 的入站控制消息处理链',-w/2+28,-h/2+50,{a:'left',s:30});});
}

function timerBar(g,t,o={}) {
  const w=o.width??1400,h=o.height??90,p=clamp(o.fill??0),c=tone(o.tone||'amber');
  item(g,t,{...o,width:w,height:h},w,h,()=>{panel(g,-w/2,-h/2,w,h,{fill:C.paper,r:18});
    g.save();rr(g,-w/2+4,-h/2+4,Math.max(.01,(w-8)*p),h-8,14);g.clip();g.fillStyle=tint(c,.28);g.fillRect(-w/2,-h/2,w,h);
    for(let x=-w/2-h;x<w/2;x+=25)line(g,[[x,h/2],[x+h,-h/2]],{c:tint(c,.5),w:5});g.restore();
    if(o.label)tag(g,o.label,0,Math.min(12,h*.2),{s:o.fontSize||30,fill:C.paper});
  });
}
function ruler(g,t,o={}) {
  const w=o.width??1100;
  item(g,t,{...o,width:w},w,90,()=>{line(g,[[-w/2,0],[w/2,0]],{w:4});
    for(const [x,v,a] of [[-w/2,'t=0','left'],[-w*.3,'t+10 ms','center'],[w/2,'约 50 ms','right']]){
      line(g,[[x,-11],[x,12]],{w:4});tag(g,v,x,-28,{f:'mono',s:30,a});}
    if(o.cursor!=null)dot(g,lerp(-w/2,w/2,clamp(o.cursor)),0,9,C.coral);
  });
}

function sessionCard(g,t,o={}) {
  const w=o.width??300,h=o.height??140;
  item(g,t,{...o,width:w,height:h},w,h,()=>{const c=o.ready?C.green:(o.warning?C.coral:C.purple);
    panel(g,-w/2,-h/2,w,h,{dashed:!o.ready,fill:o.ready?tint(C.green,.09):C.paper,stroke:c,r:22});
    label(g,'会话 '+(o.sid||'S1'),0,-8,{s:32,c});label(g,o.ready?'会话已就绪':'新会话未就绪',0,35,{s:26});
    if(o.matched)symbol(g,t,{x:w/2-25,y:-h/2+25,scale:.45,kind:'check'});
  });
}

function sessionKey(g,t,o={}) {
  item(g,t,o,160,70,()=>{g.beginPath();g.arc(-48,0,23,0,TAU);g.fillStyle=tint(C.blue,.25);g.fill();g.strokeStyle=C.ink;g.lineWidth=5;g.stroke();
    line(g,[[-24,0],[56,0],[56,18]],{w:9,c:C.blue});line(g,[[35,0],[35,16]],{w:9,c:C.blue});
    if(o.label!==false)label(g,'sessionId',0,64,{f:'mono',s:27});
  });
}
function queue(g,t,o={}) {
  const n=o.slots??2,w=o.slotWidth??310;
  item(g,t,o,n*(w+24),110,()=>{for(let i=0;i<n;i++)panel(g,-(n*(w+24))/2+i*(w+24),-55,w,110,{fill:C.paper,stroke:tint(C.ink,.3),r:20});});
}

function workstation(g,t,o={}) {
  const w=o.width??370,h=o.height??270;
  item(g,t,{...o,width:w,height:h},w,h,()=>{
    panel(g,-w/2,-h/2,w,h,{fill:tint(C.blue,.055),shadow:true});
    if(o.busy)panel(g,-w/2+8,-h/2+8,w-16,h-16,{fill:tint(C.blue,.055),stroke:C.blue,lw:3,r:18});
    if(o.label!==false)label(g,'唯一处理工位',0,-h/2-25,{s:30});
    if(o.task)message(g,t,{...o.task,compact:true,x:0,y:-42,shadow:false});
    timerBar(g,t,{x:0,y:67,width:w-44,height:56,fill:o.completion??0,label:o.progressLabel||'创建会话',fontSize:26,tone:o.highlight?'amber':'blue'});
    line(g,[[-w/2-22,-92],[-w/2-22,o.gateOpen?-126:92]],{w:12,c:o.gateOpen?C.green:C.coral});
  });
}

function codeCard(g,t,o={}) {
  item(g,t,o,1050,600,()=>{panel(g,-525,-300,1050,600,{shadow:true});label(g,'重新编写的 Kotlin 风格示意',-485,-235,{a:'left',s:28,c:C.purple});
    const lines=o.lines||CODE;if(lines.length>10)throw new Error('上屏示意代码不可超过 10 行');
    film.drawCode(g,-475,-148,lines,{s:34,lh:62,width:945,hl:o.focusLine==null?{}:{[o.focusLine]:C.amber},hlA:.16});
  });
}
function compareCard(g,t,o={}) {
  item(g,t,o,720,560,()=>{panel(g,-360,-280,720,560,{fill:o.selected?tint(C.green,.07):C.paper,stroke:o.selected?C.green:C.ink,shadow:true});
    label(g,o.title||'',0,-207,{s:38,w:900});if(o.selected)symbol(g,t,{x:292,y:-218,scale:.65,kind:'check'});
    if(o.drawBody)o.drawBody(g,t);});
}
function summaryCard(g,t,o={}) {
  item(g,t,o,1200,380,()=>{panel(g,-600,-190,1200,380,{shadow:true});panel(g,-600,-190,150,125,{fill:C.blue,r:24});
    label(g,o.index||'01',-525,-105,{f:'disp',s:74,w:900,c:C.paper});label(g,o.title||'先认会话',0,-103,{s:64,w:900});
    if(o.drawBody)o.drawBody(g,t);});
}

/* ---------------- 风格钩子 ---------------- */
function prepareStyle({mk,cw,ch}) {
  const paper=mk(cw,ch),g=paper.getContext('2d');g.scale(cw/W,ch/H);g.fillStyle=C.bg;g.fillRect(0,0,W,H);
  // 固定网格点，无噪声状态；重新生成、跨尺寸生成都对应同一逻辑坐标。
  for(let y=16;y<H;y+=28)for(let x=16;x<W;x+=28)dot(g,x,y,.9,rgba(C.ink,.055));
  return {paper};
}
function drawBackground(g,{cache}) {g.drawImage(cache.paper,0,0,W,H);}
function demoBadge(g,t,o={}) {
  item(g,t,{x:1690,y:74,...o},230,62,()=>{panel(g,-115,-31,230,62,{fill:tint(C.amber,.08),stroke:C.amber,r:18,lw:3});
    // 自绘 ⚠，避免警告符号落到彩色 emoji 字体。
    symbol(g,t,{x:-72,y:0,scale:.53,kind:'warning',tone:'amber'});label(g,o.label||'演绎',25,11,{s:28,c:C.amber});});
}
function drawChrome(g,{sc,lt}) {
  if(sc.title)return;
  line(g,[[104,53],[104,83]],{w:8,c:C.blue});label(g,CHAPTERS[sc.chap][0],128,81,{s:30,a:'left'});
  if(sc.scaled)label(g,'机制示意·时间已缩放',104,131,{s:24,a:'left',c:C.amber});
  if(sc.demo || (sc.demoAt!=null&&lt>=sc.demoAt))demoBadge(g,lt);
}
function captionState(g,frame) {
  const {sc,lt}=frame;if(sc.title||!sc.captions?.length)return null;
  const i=sc.cs.findIndex((s,i)=>lt>=s&&lt<sc.ce[i]);if(i<0)return null;
  const c={t0:sc.start+sc.cs[i],t1:sc.start+sc.ce[i],text:sc.captions[i].text},layout=film.captionLayout(g,c,frame.t);
  if(!layout)return null;
  return {layout,alpha:Math.min(seg(lt,sc.cs[i],sc.cs[i]+.1),1-seg(lt,sc.ce[i]-.1,sc.ce[i]))};
}
function drawCaptionBackground(g,frame) {
  const c=captionState(g,frame);if(!c)return;
  const lines=c.layout.lines,w=Math.max(...lines.map(l=>l.width))+76,top=lines[0].y-74,h=(lines.length-1)*68+108;
  g.globalAlpha*=c.alpha;panel(g,(W-w)/2,top,w,h,{fill:C.paper,r:24,shadow:true});
}
function drawCaption(g,layout,frame) {
  if(frame.sc.title||frame.t>=layout.caption.t1)return;
  // 引擎默认在 t1 后淡出；本片改为区间内淡出，确保任意时刻只出现一句。
  g.globalAlpha=Math.min(seg(frame.t,layout.caption.t0,layout.caption.t0+.1),1-seg(frame.t,layout.caption.t1-.1,layout.caption.t1));
  for(const l of layout.lines){let x=l.x;
    for(const s of l.segments){const width=tw(g,s.s,layout.font);
      if(s.c===C.amber){panel(g,x-2,l.y+4,width+4,9,{fill:tint(C.amber,.35),lw:0,r:3});}
      txt(g,s.s,x,l.y,{...layout.font,c:s.c||C.ink});x+=width;}
  }
}
/* ---------------- 章节卡与共用布局 ---------------- */
// 章节卡占本幕上方的固定条带；不增时，不遮挡字幕和 +0.4 s 起的叙事事件。
function chapterCard(g,t,n) {
  const [zh,en]=CHAPTERS[n],title=zh.split('｜').pop();
  panel(g,100,160,1720,110,{fill:C.blue,shadow:true,r:24});
  label(g,String(n-1).padStart(2,'0'),138,242,{f:'disp',s:70,w:900,c:C.paper,a:'left'});
  label(g,title,275,229,{s:42,w:900,c:C.paper,a:'left'});
  label(g,en,1778,224,{s:24,f:'disp',w:800,c:C.paper,a:'right'});
}
function beforeScene(g,{sc,lt}) {
  // Opening, title and the two closing scenes own their explicitly scripted transitions.
  if(!['s01','s02','s28','s29'].includes(sc.id))g.globalAlpha*=Math.min(seg(lt,0,.3),1-seg(lt,sc.d-.3,sc.d));
}
function trio(g,t,o={}) {
  const y=o.y??335,scale=o.scale??1.5;
  screen(g,t,{x:340,y,role:'A',uiText:o.a||'主叫',button:o.aButton,pressedAt:o.pressedAt,scale});
  gateway(g,t,{x:960,y,active:o.active,scale});
  screen(g,t,{x:1580,y,role:'B',uiText:o.b||'被叫',ringing:o.ringing,ringAt:o.ringAt,scale});
}
function states(g,t,a,b,o={}) {
  stateLabel(g,t,{x:340,y:o.y??500,state:a,tone:a.startsWith('ENDED')?'coral':'blue',emphasis:o.emphasis});
  stateLabel(g,t,{x:1580,y:o.y??500,state:b,tone:b.startsWith('ENDED')?'green':'amber',emphasis:o.emphasis});
}
function legend(g,t,o={}) {
  // Three complete device groups: [184,454], [471,637], [654,839].
  // Group gaps exceed 16 px, including antennae, shadows and label descenders.
  panel(g,100,165,350,687,{fill:C.paper,r:24});
  screen(g,t,{x:275,y:252,role:'A',roleLabel:false,uiText:o.cancel?'已取消':'呼叫中',scale:.94});
  label(g,'主叫屏 A',275,360,{s:26,c:C.blue});
  if(o.travel){}
  else if(o.cancel)stateLabel(g,t,{x:275,y:412,width:320,height:80,fontSize:24,lineHeight:33,state:'ENDED.SELF_TERMINATED',tone:'coral'});
  else label(g,'CALLING',275,420,{s:28,f:'mono',c:C.blue});
  gateway(g,t,{x:275,y:539,scale:.8,label:false,active:o.active});label(g,'网关',275,630,{s:26,c:C.purple});
  screen(g,t,{x:275,y:722,scale:.94,role:'B',roleLabel:false,uiText:o.b||'创建中',ringing:false});
  label(g,'被叫屏 B',275,832,{s:26,c:C.amber});
}
function logSlot(g,t,o={}) {
  const w=o.width??450;
  panel(g,o.x-w/2,o.y-75,w,150,{fill:tint(C.ink,.08),stroke:tint(C.ink,.4),r:20});
  label(g,o.empty&&!o.receiving?'日志槽（空）':'未匹配会话：忽略',o.x,o.y-29,{s:26,c:tint(C.ink,.75)});
  if(!o.empty)message(g,t,{...MSG.terminate,x:o.x,y:o.y+30,compact:true,width:300,opacity:.25,shadow:false});
}
function clockFace(g,t,o={}) {
  const r=o.r??100,p=clamp(o.remaining??1);
  dot(g,o.x,o.y,r,C.paper);g.save();g.strokeStyle=C.ink;g.lineWidth=5;g.stroke();
  g.strokeStyle=tone(o.tone||'amber');g.lineWidth=12;g.beginPath();g.arc(o.x,o.y,r-14,-TAU/4,-TAU/4+TAU*p);g.stroke();g.restore();
  label(g,o.text||'60 s',o.x,o.y+15,{f:'disp',s:o.size??46,w:900});
}
function media(g,t,start=0,reverse=false,y=805) {
  const path=reverse?[[1580,y],[960,y],[340,y]]:[[340,y],[960,y],[1580,y]];
  line(g,path,{c:tint(C.green,.3),w:6});
  for(let i=0;i<2;i++){const dt=t-start-i*2;if(dt>=0&&dt<1.2){const p=pathAt(path,dt/1.2);dot(g,p.x,p.y,10,C.green);}}
}
function networkBranch(g,t,start=1,o={}) {
  if(o.local){
    // A small signal follows B → gateway → A beside the device column. The full
    // capsule has its own top-right band, so it never flies across screen text.
    const path=[[410,722],[480,722],[480,539],[350,539],[480,539],[480,252],[410,252]];
    if(t<start+1.2){
      arrow(g,t,{points:path,tone:'blue',opacity:.35,lineWidth:3});
      const p=pathAt(path,seg(t,start,start+1.2));dot(g,p.x,p.y,8,C.blue);
      message(g,t,{...MSG.ring,x:1640,y:310,shadow:false});
    }else tag(g,'102 RING · 经网关，后续不展开',1510,304,{s:24,c:C.blue});
    return;
  }
  const path=[[1580,590],[960,590],[340,590]];
  arrow(g,t,{points:path,tone:'blue',opacity:.35});
  flight(g,t,{...MSG.ring,points:path,start,end:start+1.2,hold:0});
  if(t>=start+1.2)tag(g,'102 RING · 经网关，后续不展开',960,591,{s:24,c:C.blue});
}
function drawOpening(g,t) {
  const close=eio(seg(t,14.7,15)),drop=30*eo(seg(t,3.6,3.96));
  trio(g,t,{y:lerp(350,690,close),scale:1.5,a:'已取消',b:'还在响',ringing:true,ringAt:t<4?.4:4});
  fade(g,1-seg(t,14.55,14.7),()=>{
    states(g,t,'ENDED.SELF_TERMINATED','RINGING',{y:515});
    arrow(g,t,{points:[[340,610],[960,650],[1170,650]],dashed:true,blocked:true,opacity:.5});
    arrow(g,t,{points:[[1410,650],[1580,650]],dashed:true,opacity:.5});
    message(g,t,{...MSG.terminate,x:960,y:640+drop});
    if(t>=7.2)timerBar(g,t,{x:1270,y:792,width:700,height:84,fill:.2,label:'创建会话：约 50 ms',opacity:eo(seg(t,7.2,7.7))});
    if(t>=11)symbol(g,t,{x:1230,y:655,kind:'question',tone:'coral',enterAt:11});
  });
}
function drawTitle(g,t) {
  const second=eio(seg(t,4.8,5.2)),lift=eio(seg(t,6.7,7)),yy=lerp(690,335,lift);
  label(g,SCRIPT.s02.captions[0].text,960,lerp(395,200,second)+24*(1-eo(seg(t,0,.4))),{s:lerp(82,48,second),w:900,al:1-seg(t,6.4,6.7)});
  if(t>=4.8)label(g,SCRIPT.s02.captions[1].text,960,465,{s:94,w:900,c:C.blue,al:seg(t,5.05,5.2)*(1-seg(t,6.4,6.7))});
  arrow(g,t,{points:[[340,yy],[960,yy+25],[1580,yy]],reveal:seg(t,.4,1.2),opacity:.55});
  trio(g,t,{y:yy,scale:1.5});
}
function drawRoute(g,t) {
  chapterCard(g,t,2);
  const path=[[340,625],[960,625],[1580,625]];
  arrow(g,t,{points:path,reveal:seg(t,.4,1.4),opacity:.6});
  trio(g,t,{y:475,scale:1.5,a:'自己的状态',b:'自己的状态',active:t>=4.6&&t<4.8});
  if(t>=4&&t<5.2){const p=pathAt(path,seg(t,4,5.2));panel(g,p.x-28,p.y-19,56,38,{fill:tint(C.blue,.2),r:8});line(g,[[p.x-26,p.y-17],[p.x,p.y+3],[p.x+26,p.y-17]],{w:3});}
  [340,960,1580].forEach((x,i)=>boxText(g,i===1?'转送字节':'通话状态',x,730,390,120,{s:36,stroke:t>=8&&i!==1?C.blue:C.ink}));
  tag(g,'自研协议 · 借鉴 SIP 信令思想 · 图中编号为本方案消息码',960,824,{s:24,c:C.purple});
}
function drawHandshake(g,t) {
  const calling=t>=.5,aRing=t>=5.6,bRing=t>=4;
  lanes(g,t);tag(g,'正常路径',960,500,{s:28,c:C.blue});
  trio(g,t,{a:aRing?'响铃中':calling?'呼叫中':'空闲',b:bRing?'响铃中':t>=2.2?'创建中':'空闲',aButton:'call',pressedAt:.5,ringing:bRing,ringAt:4});
  states(g,t,aRing?'RINGING':calling?'CALLING':'IDLE',bRing?'RINGING':'IDLE');
  if(t>=1)arrow(g,t,{points:T.outgoing,reveal:seg(t,1,2.2),tone:'blue',opacity:.4});
  if(t>=4.4)arrow(g,t,{points:T.incoming,reveal:seg(t,4.4,5.6),tone:'blue',opacity:.5,lineWidth:t>=8.6?6:4});
  flight(g,t,{...MSG.invite,points:T.outgoing,start:1,end:2.2,hold:.4});
  flight(g,t,{...MSG.ring,points:T.incoming,start:4.4,end:5.6,hold:.4});
  if(t>=2.6)tag(g,'101 INVITE',960,602,{f:'mono',s:30,c:C.blue});
  if(t>=6)tag(g,'102 RING',960,778,{f:'mono',s:30,c:C.blue});
  if(t>=2.2&&t<4)timerBar(g,t,{x:1480,y:784,width:510,height:62,fill:seg(t,2.2,4),label:'创建，时间已缩放',fontSize:26});
  if(t>=.5&&t<5.95)retry(g,t,{x:430,y:680,running:t<5.6,opacity:1-seg(t,5.6,5.95)});
}
function drawAccept(g,t) {
  const accepted=t>=.4,chat=t>=4.4;
  const path=[[1580,585],[960,615],[340,645]];
  lanes(g,t);trio(g,t,{a:chat?'通话中':'响铃中',b:accepted?'准备中':'响铃中'});
  stateLabel(g,t,{x:340,y:500,state:chat?'CHATTING':'RINGING'});
  stateLabel(g,t,{x:1580,y:500,state:accepted?'PREPARE':'RINGING',tone:'amber',emphasis:t>=9});
  if(!accepted)boxText(g,'接听',1580,625,180,72,{fill:tint(C.green,.14)});
  if(t>=3.2)arrow(g,t,{points:path,reveal:seg(t,3.2,4.4),tone:'green',opacity:.4});
  if(t<4.4)flight(g,t,{...MSG.accept,points:path,start:3.2,end:4.4,hold:0});
  if(chat){
    const p={x:340,y:705};
    message(g,t,{...MSG.confirm,x:p.x,y:p.y});
    media(g,Math.min(t,4.6),4.4,false,809);tag(g,'300 VOICE_DATA · 媒体轨道',1200,810,{s:26,f:'mono',c:C.green});
  }
  if(t>=4.6)tag(g,'网关只转发',960,502,{s:28,c:C.purple});
}
function drawConfirm(g,t) {
  const chat=t>=1.5,card=t>=8.4;
  if(card){
    const p=eio(seg(t,8.4,9.2));
    boxText(g,'主叫屏 A',460,350,500,100,{s:40,fill:tint(C.blue,.15)});
    boxText(g,'被叫屏 B',1460,350,500,100,{s:40,fill:tint(C.amber,.15)});
    stateNode(g,t,{x:460,y:565,width:500,height:180,label:'CHATTING',current:true,tone:'blue'});
    stateNode(g,t,{x:1460,y:565,width:500,height:180,label:'CHATTING',current:true,tone:'amber'});
    arrow(g,t,{points:[[730,565],[1190,565]],tone:'green',reveal:p});tag(g,'消息经网关',960,533,{s:28,c:C.purple});
    tag(g,'两块屏，各有自己的状态',960,770,{s:38,c:C.blue});return;
  }
  trio(g,t,{a:'通话中',b:chat?'通话中':'准备中'});states(g,t,'CHATTING',chat?'CHATTING':'PREPARE');
  const path=[[340,705],[960,705],[1580,705]];
  arrow(g,t,{points:path,reveal:seg(t,.3,1.5),tone:'green',opacity:.4});
  if(t<.3)message(g,t,{...MSG.confirm,x:340,y:705});
  flight(g,t,{...MSG.confirm,points:path,start:.3,end:1.5,hold:.5});
  if(t>=2)tag(g,'201 PREPARE_CONFIRM',960,615,{s:30,f:'mono',c:C.green});
  media(g,t,4,false,744);if(chat)media(g,t,t<4?1.5:4,true,817);
  tag(g,'300 VOICE_DATA · 双向媒体',960,788,{s:26,f:'mono',c:C.green});
}
function drawRewind(g,t) {
  if(t>=8){drawGap(g,0);return;}
  chapterCard(g,t,3);trio(g,t,{y:495,a:'呼叫中',b:t>=4?'创建中':'等待邀请'});
  if(t<2.8||t>=3.3)stateLabel(g,t,{x:340,y:655,state:'CALLING'});
  if(t>=4)sessionCard(g,t,{x:1580,y:705,ready:false});
  const path=[[340,680],[960,680],[1580,680]];
  if(t<4)flight(g,t,{...MSG.invite,sid:'S1',points:path,start:2.8,end:4,hold:0});
  if(t>=4)tag(g,'t=0：B 收到邀请',960,700,{s:30,c:C.amber});
  tag(g,'S1 = 这次通话的编号（sessionId）',960,784,{s:30,c:C.blue});
  tag(g,'图中为视觉缩写，非真实标识值',960,832,{s:24,c:C.purple});
}
function drawGap(g,t) {
  const p=.2*seg(t,0,4.6),cancel=t>=4.6,flash=t>=9.2&&t<9.8&&Math.floor((t-9.2)*7)%2===0;
  legend(g,t,{cancel,travel:t>=4.6&&t<5.8,active:t>=5.2&&t<5.35});
  boundary(g,t,{x:1160,y:520,width:1320,height:600,title:'B 的会话创建窗口'});
  ruler(g,t,{x:1175,y:365,width:1050,cursor:p});
  timerBar(g,t,{x:1175,y:475,width:1050,height:84,fill:p,label:'创建会话：约 50 ms'});
  sessionCard(g,t,{x:1570,y:677,ready:false,warning:flash});
  if(t>=5.8){line(g,[[860,378],[860,560]],{c:C.coral,w:4});arrow(g,t,{points:[[1040,675],[1370,675]],tone:'coral',blocked:true});}
  // Label is below the line's endpoint, on opaque backing; it never crosses the red stem.
  if(t>=5.8)tag(g,'构造的到达点',860,585,{s:26,c:C.coral});
  const path=[[275,420],[275,479.5],[275,539],[540,539],[860,675]];
  if(cancel&&t<5.8)flight(g,t,{...MSG.terminate,sid:'S1',points:path,start:4.6,end:5.8,hold:0});
  if(t>=5.8)message(g,t,{...MSG.terminate,x:860,y:675,sid:'S1'});
  tag(g,'t=0：B 收到邀请',680,785,{s:24,a:'left'});
}
function drawMatchMiss(g,t) {
  const lost=t>=9.2,p=seg(t,9.2,10),outgoing=pathAt([[580,465],[580,585],[1180,720],[1500,720]],p);
  const x=lost?outgoing.x:lerp(310,580,seg(t,.4,1.4)),y=lost?outgoing.y:465;
  arrow(g,t,{points:[[740,450],[1150,450],[1150,325],[1340,325]],tone:'purple',dashed:t>=4.6,blocked:true});
  arrow(g,t,{points:[[890,540],[890,690],[1270,690]],tone:t>=4.6?'coral':'ink',opacity:t>=4.6?1:.3});
  boxText(g,'会话匹配器',890,465,370,150,{s:40});
  sessionCard(g,t,{x:1500,y:325,ready:false});
  logSlot(g,t,{x:1500,y:690,empty:t<10,receiving:lost});
  tag(g,'匹配当前会话 → 交给状态机',1030,248,{s:28,c:C.purple});
  tag(g,'不匹配且非邀请 → 仅记日志',970,824,{s:28,c:C.coral});
  tag(g,'机制示意，非原始日志',1500,806,{s:24,c:C.purple});
  if(t<10)message(g,t,{...MSG.terminate,sid:'S1',x,y});
}
function drawLate(g,t) {
  const ready=t>=.8;
  trio(g,t,{a:'已取消',b:ready?'响铃中':'创建中',ringing:ready,ringAt:t<4.6?.8:t<9.2?4.6:9.2});
  stateLabel(g,t,{x:340,y:500,state:'ENDED.SELF_TERMINATED',tone:'coral'});
  if(ready)stateLabel(g,t,{x:1580,y:500,state:'RINGING',tone:'amber'});
  networkBranch(g,t);
  sessionCard(g,t,{x:1580,y:744,ready});
  logSlot(g,t,{x:550,y:744,width:470});
  clockFace(g,t,{x:1140,y:744,r:76,remaining:1,text:'60 s',size:36});
  tag(g,ready?'创建完成：约 50 ms':'创建中',960,488,{s:28,c:C.amber});
  if(t>=9.2)tag(g,'结果没对齐',960,657,{s:32,c:C.coral});
}
function drawOwnership(g,t) {
  chapterCard(g,t,4);
  arrow(g,t,{points:[[510,490],[665,490]],tone:'blue'});
  arrow(g,t,{points:[[1115,490],[1300,490]],tone:'green',reveal:seg(t,8,8.8)});
  boxText(g,'sessionId: S1',320,490,390,200,{s:32,f:'mono',fill:tint(C.blue,.08)});
  sessionCard(g,t,{x:890,y:490,ready:true,matched:t>=4,width:430,height:200});
  boxText(g,'状态机',1530,490,430,200,{s:42,fill:t>=8.8?tint(C.green,.14):tint(C.ink,.08),stroke:t>=8.8?C.green:C.ink});
  tag(g,'消息',320,345,{s:32});tag(g,'会话匹配',890,345,{s:32});tag(g,t>=8.8?'开始状态转移':'尚未收到输入',1530,650,{s:28});
  sessionKey(g,t,{x:lerp(700,850,eio(seg(t,4,4.4))),y:715,label:false});
  boxText(g,'会话 S2',1150,723,240,90,{s:28,fill:tint(C.ink,.08)});
}
function drawRules(g,t) {
  const replay=t>=8,aEnded=t>=1.2,bEnded=t>=5.2&&!replay;
  for(const [x,name,toneName] of [[500,'主叫屏 A','blue'],[1420,'被叫屏 B','amber']]){
    panel(g,x-400,220,800,610,{fill:C.paper,shadow:true});label(g,name,x,285,{s:34,c:tone(toneName)});
  }
  stateArrow(g,t,{points:[[500,425],[500,615]],tone:'blue',reveal:seg(t,.4,1.2)});
  stateArrow(g,t,{points:[[1420,425],[1420,615]],tone:replay?'ink':'green',opacity:replay?.15:1,reveal:seg(t,4,5.2)});
  stateNode(g,t,{x:500,y:370,label:'CALLING / RINGING',width:500,current:!aEnded});
  stateNode(g,t,{x:500,y:680,label:'ENDED.SELF_TERMINATED',width:500,current:aEnded});
  stateNode(g,t,{x:1420,y:370,label:'RINGING',width:500,current:!bEnded&&!replay,tone:'amber'});
  stateNode(g,t,{x:1420,y:680,label:'ENDED.OTHER_TERMINATED',width:500,current:bEnded,tone:'green'});
  tag(g,'用户取消',500,515,{s:28});tag(g,replay?'刚才：消息未到状态机':'收到 402 TERMINATE_END',1420,490,{s:28,c:replay?C.coral:C.green});
  message(g,t,{...MSG.terminate,x:500,y:783,outlined:true,shadow:false});
  if(t>=4&&t<5.2)message(g,t,{...MSG.terminate,x:1420,y:lerp(548,575,seg(t,4,5.2)),outlined:true,shadow:false});
  if(replay){line(g,[[1135,560],[1250,560]],{c:C.coral,dashed:true});line(g,[[1510,560],[1695,560]],{c:C.coral,dashed:true});symbol(g,t,{x:1420,y:568,kind:'cross',tone:'coral',scale:.55});}
}
function drawConcurrency(g,t) {
  boundary(g,t,{x:960,y:520,title:'B 的本地处理区'});
  ruler(g,t,{x:1030,y:330,width:1260,cursor:.2*seg(t,.4,4)});
  tag(g,'创建会话',260,432,{s:30});tag(g,'处理取消',260,625,{s:30});
  if(t>=8)panel(g,660,355,270,340,{fill:tint(C.coral,.12),stroke:C.coral,r:20});
  timerBar(g,t,{x:1030,y:425,width:1260,height:90,fill:.2*seg(t,.4,4),label:'约 50 ms · 尚未完成'});
  line(g,[[652,345],[652,535]],{c:C.coral,w:5});
  tag(g,'t+10 ms · 构造值',652,537,{s:26,c:C.coral});
  if(t>=4)message(g,t,{...MSG.terminate,sid:'S1',x:770,y:625});
  sessionCard(g,t,{x:1510,y:625,ready:false});
  panel(g,530,738,480,85,{fill:tint(C.ink,.08),stroke:tint(C.ink,.4)});label(g,'未匹配 → 仅记日志',770,790,{s:30,c:C.coral});
  if(t>=4.6)arrow(g,t,{points:[[770,688],[770,735]],tone:'coral'});
}
function drawTimeout(g,t) {
  const expired=t>=4.8,p=1-seg(t,.4,3.8);
  boundary(g,t,{x:960,y:520,title:'B 本地：响铃超时兜底'});
  clockFace(g,t,{x:490,y:465,r:175,remaining:p,text:String(Math.ceil(60*p))+' s',size:74});
  tag(g,'快进',490,695,{s:30,c:C.amber});tag(g,'从 B 开始响铃起',490,755,{s:30});
  screen(g,t,{x:1500,y:405,scale:1.5,role:'B',uiText:expired?'超时结束':'响铃中',ringing:!expired,ringAt:.4});
  stateNode(g,t,{x:1390,y:720,width:570,height:150,label:expired?'ENDED.RINGING_TIMEOUT':'RINGING',current:true,tone:expired?'coral':'amber'});
  const path=[[720,465],[1020,565],[1390,600]];
  arrow(g,t,{points:path,tone:'purple',reveal:seg(t,4,4.8)});
  if(t<4.8)flight(g,t,{...MSG.timeout,points:path,start:4,end:4.8,hold:0});
  if(t>=4.8)tag(g,'404 TIMEOUT_END · 本地产生',1220,595,{s:28,f:'mono',c:C.purple});
  if(t>=8)tag(g,'等到超时',1410,819,{s:30,c:C.coral});
}
/* ---------------- 排队、重放与收束 ---------------- */
function drawChoice(g,t) {
  chapterCard(g,t,5);
  const chosen=t>=7;
  // Three equal-width candidates keep every noun in the second caption visible.
  const envelope=(x,y)=>{
    panel(g,x-29,y-25,58,50,{fill:tint(C.blue,.12),r:9,lw:3});
    line(g,[[x-23,y-17],[x,y+1],[x+23,y-17]],{c:C.blue,w:3});
  };
  for(const x of [100,690])panel(g,x,315,540,515,{fill:chosen?tint(C.ink,.16):C.paper,shadow:true});
  fade(g,chosen?.38:1,()=>{
    label(g,'加锁',370,388,{s:36,w:900});
    panel(g,350,515,240,145,{fill:tint(C.blue,.07),r:20});
    // The shackle straddles the shared session's top edge; messages wait outside.
    g.save();g.strokeStyle=C.amber;g.lineWidth=12;rr(g,439,454,62,88,30);g.stroke();g.restore();
    panel(g,423,500,94,76,{fill:tint(C.amber,.24),stroke:C.amber,r:12});
    dot(g,470,528,8,C.amber);line(g,[[470,532],[470,548]],{c:C.amber,w:7});
    label(g,'共享会话',470,623,{s:30});
    envelope(170,611);envelope(245,611);
    arrow(g,t,{points:[[288,611],[326,611]],tone:'blue'});
    tag(g,'等待解锁',220,733,{s:28,c:C.amber});
    label(g,'Handler 同步屏障',960,388,{s:34,w:900});
    panel(g,720,486,270,125,{fill:tint(C.blue,.04),stroke:tint(C.ink,.35),r:16});
    for(let i=0;i<3;i++)envelope(756+i*76,548);
    // A full-height striped barrier blocks the queue throughout the comparison.
    panel(g,972,463,22,175,{fill:tint(C.coral,.18),stroke:C.coral,r:5,lw:3});
    for(let y=478;y<628;y+=28)line(g,[[976,y],[990,y+12]],{c:C.coral,w:5});
    line(g,[[958,643],[1008,643]],{c:C.coral,w:7});
    arrow(g,t,{points:[[1014,548],[1045,548]],tone:'blue'});
    boxText(g,'处理',1130,548,130,120,{s:30,fill:tint(C.blue,.1)});
    boxText(g,'暂停 / 恢复',960,725,320,84,{s:30});
  });
  panel(g,1280,315,540,515,{fill:chosen?tint(C.green,.07):C.paper,stroke:chosen?C.green:C.ink,shadow:true});
  label(g,'Flow 串行消费',1550,388,{s:36,w:900});
  for(let i=0;i<3;i++)panel(g,1310+i*76,505,58,86,{fill:i===2?tint(C.blue,.15):C.paper,r:13});
  arrow(g,t,{points:[[1545,548],[1610,548]],tone:'blue'});boxText(g,'工位',1710,548,150,150,{s:32,fill:tint(C.blue,.1)});
  if(chosen)symbol(g,t,{x:1760,y:432,kind:'check',scale:.7});
  if(t>=10.4){boxText(g,'好懂',1425,725,190,84,{s:34,fill:tint(C.green,.1)});boxText(g,'好维护',1660,725,210,84,{s:34,fill:tint(C.green,.1)});}
}
function drawQueue(g,t) {
  boundary(g,t,{x:960,y:520,title:'B 的入站控制消息处理链'});
  label(g,'SharedFlow',145,334,{s:32,f:'mono',a:'left',c:C.blue});
  label(g,'collect：逐条完成',1170,282,{s:30,f:'mono'});
  // Two waiting slots plus the station form the readable three-position queue.
  queue(g,t,{x:510,y:495,slots:2,slotWidth:310});
  const busy=t>=2;
  workstation(g,t,{x:1170,y:495,busy,task:busy?{...MSG.invite,sid:'S1'}:null,completion:busy?.2:0,gateOpen:!busy,highlight:t>=7});
  sessionCard(g,t,{x:1630,y:495,ready:false});
  if(t>=.4&&t<1.2)message(g,t,{...MSG.invite,sid:'S1',x:665,y:lerp(420,495,eo(seg(t,.4,.8)))});
  if(t>=1.2&&t<2)message(g,t,{...MSG.invite,sid:'S1',x:lerp(665,1170,eio(seg(t,1.2,2))),y:lerp(495,453,eio(seg(t,1.2,2)))});
  if(t>=.8)message(g,t,{...MSG.terminate,sid:'S1',x:lerp(330,665,eio(seg(t,3.6,4))),y:495});
  if(t>=3.6)tag(g,'等待',665,615,{s:30,c:C.coral});
  if(t>=7)tag(g,'创建也在本次处理内',1170,693,{s:30,c:C.amber});
  if(t>=10.4){
    // A condition connection, not a release: line endpoints and text occupy distinct bands.
    line(g,[[960,766],[963,660],[963,610]],{c:C.amber,w:6});
    line(g,[[962,766],[1300,766]],{c:C.amber,w:6});
    tag(g,'才放行',830,778,{s:30,c:C.amber});tag(g,'创建完成',1420,778,{s:30,c:C.amber});
  }
}
function drawCodeBoundary(g,t) {
  const focus=t<.4?null:t<4.6?0:t<9.2?2:4;
  codeCard(g,t,{x:625,y:500,focusLine:focus});
  const xs=1535,ys=[330,500,720];
  arrow(g,t,{points:[[xs,379],[xs,440]],tone:'blue'});
  if(t>=9.2)arrow(g,t,{points:[[xs,559],[xs,659]],tone:'green',reveal:seg(t,9.2,10)});
  ['取消息','完成处理','取下一条'].forEach((v,i)=>boxText(g,v,xs,ys[i],500,110,{s:38,fill:(t<4.6?i===0:t<9.2?i===1:i===2)?tint(C.blue,.15):C.paper}));
  if(t>=9.2)tag(g,'下一次迭代',xs,620,{s:26,c:C.green});
}
function drawFullBoundary(g,t) {
  tag(g,'只排启动动作 ≠ 等完整处理结束',960,185,{s:24,c:C.purple});
  fade(g,t>=7?.35:1,()=>{
    panel(g,100,230,1720,255,{fill:C.paper,shadow:true});label(g,'只排启动动作',140,284,{s:30,a:'left',c:C.coral});
    panel(g,700,310,500,135,{fill:tint(C.blue,.06),r:20});
    timerBar(g,t,{x:950,y:399,width:440,height:52,fill:.2,label:'创建尚未完成',fontSize:26});
    const p=eio(seg(t,.4,3.6));
    boxText(g,'创建任务',lerp(950,1550,p),lerp(343,288,p),250,70,{s:28,fill:tint(C.blue,.12)});
    sessionCard(g,t,{x:1550,y:400,ready:false,width:320,height:128});
    if(t>=3.6){const q=seg(t,3.6,4.2);message(g,t,{...MSG.terminate,sid:'S1',x:lerp(480,1260,q),y:320});if(t>=4.2)symbol(g,t,{x:1425,y:338,kind:'cross',scale:.6,tone:'coral'});}
    symbol(g,t,{x:1750,y:285,kind:'cross',tone:'coral',scale:.6});
  });
  panel(g,100,535,1720,295,{fill:C.paper,stroke:t>=7?C.green:C.ink,shadow:true});label(g,'等完整处理结束',140,590,{s:30,a:'left',c:C.green});
  const completed=t>=12,p=seg(t,10.4,12);
  panel(g,700,620,500,170,{fill:tint(C.blue,.06),r:20});
  timerBar(g,t,{x:950,y:752,width:440,height:52,fill:p,label:completed?'创建完成':'创建会话 · 直到完成',fontSize:26});
  line(g,[[670,635],[670,completed?610:795]],{c:completed?C.green:C.coral,w:10});
  const incoming=pathAt([[460,699],[590,674],[950,674]],seg(t,12,12.6));
  if(t<12.6)message(g,t,{...MSG.terminate,sid:'S1',x:completed?incoming.x:460,y:completed?incoming.y:699});
  sessionCard(g,t,{x:1550,y:711,ready:completed,width:320});
  symbol(g,t,{x:1750,y:590,kind:'check',scale:.6});
}
// Replayed local processing uses one consistent layout across scenes 19–21.
function replayLayout(g,t,o={}) {
  legend(g,t,{cancel:o.cancel,travel:o.travel,b:o.ended?'已结束':o.ready?'响铃中':'创建中'});
  boundary(g,t,{x:1160,y:o.chapter?575:535,width:1320,height:o.chapter?550:630,title:o.chapter?false:'B 的入站控制消息处理链'});
  boxText(g,'等待槽',720,390,330,80,{s:30,fill:o.waiting?tint(C.amber,.15):C.paper});
  panel(g,555,454,330,112,{fill:C.paper,stroke:o.waiting?C.amber:tint(C.ink,.35),r:20});
  workstation(g,t,{x:1180,y:520,busy:!o.ended,task:o.task,completion:o.completion??.2,gateOpen:o.gateOpen,label:true,progressLabel:o.ready?'创建完成':'创建被叫会话'});
  sessionCard(g,t,{x:1640,y:520,ready:o.ready,matched:o.matched,width:300});
  if(o.waiting)message(g,t,{...MSG.terminate,sid:'S1',x:720,y:510});
  tag(g,o.time||'t=0：B 收到邀请',1160,819,{s:30,c:C.amber});
}
function drawReplayInvite(g,t) {
  // The chapter card lives above the local panel as a compact card, without hiding the network flight.
  replayLayout(g,t,{chapter:true,travel:t>=.4&&t<1.6,task:t>=2.6?{...MSG.invite,sid:'S1'}:null,completion:t>=4?.2*seg(t,4,8):0,gateOpen:t<2.6,time:t>=1.6?'t=0：B 收到邀请':'邀请经网关进入 B'});
  panel(g,500,165,1320,110,{fill:C.blue,shadow:true});
  label(g,'05',540,247,{s:64,w:900,f:'disp',c:C.paper,a:'left'});
  label(g,'这回，终于接住了',680,220,{s:40,w:900,c:C.paper,a:'left'});
  label(g,CHAPTERS[6][1],680,260,{s:24,f:'disp',c:C.paper,a:'left'});
  const path=[[275,420],[275,539],[720,510]];
  flight(g,t,{...MSG.invite,sid:'S1',points:path,start:.4,end:1.6,hold:.4});
  if(t>=2&&t<2.6)message(g,t,{...MSG.invite,sid:'S1',x:lerp(720,1180,seg(t,2,2.6)),y:lerp(510,478,seg(t,2,2.6))});
  if(t>=8)tag(g,'处理中 · 不取下一条',1180,714,{s:30,c:C.blue});
}
function drawReplayWait(g,t) {
  replayLayout(g,t,{cancel:t>=.4,travel:t>=.6&&t<1.8,waiting:t>=1.8,task:{...MSG.invite,sid:'S1'},time:t>=1.8?'t+10 ms（构造值）':'创建仍在进行中'});
  const path=[[275,420],[275,539],[720,510]];
  if(t<1.8)flight(g,t,{...MSG.terminate,sid:'S1',points:path,start:.6,end:1.8,hold:0});
  tag(g,'日志槽（空）',1650,720,{s:26,c:tint(C.ink,.6)});
  if(t>=4)tag(g,'先等在这里',720,645,{s:28,c:C.amber});
  if(t>=8){const x=t<8.4?1180:t<8.8?1640:720;symbol(g,t,{x,y:670,kind:'check',scale:.5,tone:'blue'});}
}
function drawReplayFinish(g,t) {
  const ready=t>=1,taking=t>=4.2,matched=t>=5,ended=t>=8.6;
  replayLayout(g,t,{cancel:true,travel:t>=1&&t<2.2,ready,ended,matched,waiting:!taking,gateOpen:taking,task:!taking?{...MSG.invite,sid:'S1'}:t>=5?{...MSG.terminate,sid:'S1'}:null,completion:.2+.8*seg(t,.4,1),time:ready?'创建完成后，依次处理':'创建会话：约 50 ms'});
  if(t>=1)networkBranch(g,t,1,{local:true});
  if(taking&&t<5)message(g,t,{...MSG.terminate,sid:'S1',x:lerp(720,1180,seg(t,4.2,5)),y:lerp(510,478,seg(t,4.2,5))});
  if(ready){
    stateLabel(g,t,{x:1615,y:691,width:360,state:ended?'ENDED.OTHER_TERMINATED':'RINGING',tone:ended?'green':'amber'});
    if(!ended){clockFace(g,t,{x:720,y:692,r:58,size:30,text:'60 s',remaining:1});tag(g,'响铃计时已启动',1130,747,{s:26,c:C.amber});}
    else {stateNode(g,t,{x:720,y:692,width:300,height:76,label:'RINGING'});arrow(g,t,{points:[[900,692],[1400,692]],tone:'green',reveal:seg(t,8.6,9)});tag(g,'响铃计时已停止',1130,747,{s:26,c:C.green});}
  }
}
function drawAligned(g,t) {
  trio(g,t,{a:'已取消',b:'呼叫已结束'});states(g,t,'ENDED.SELF_TERMINATED','ENDED.OTHER_TERMINATED',{emphasis:t>=4.2});
  const p=seg(t,.4,1.2);line(g,[[lerp(960,340,p),600],[960,600],[lerp(960,1580,p),600]],{c:C.green,w:7});
  tag(g,'本次呼叫均已结束',960,612,{s:34,c:C.green});
  const xs=[410,960,1510];
  arrow(g,t,{points:[[625,758],[745,758]],tone:'green'});arrow(g,t,{points:[[1175,758],[1295,758]],tone:'green'});
  ['创建完成','处理取消','结束呼叫'].forEach((v,i)=>boxText(g,v,xs[i],758,420,126,{s:36,fill:t>=8.6+i*.7?tint(C.green,.13):C.paper}));
}
function drawSeparate(g,t) {
  arrow(g,t,{points:[[460,250],[960,250],[1460,250]],tone:'purple',opacity:t>=8?1:.4});
  gateway(g,t,{x:960,y:250,scale:1.1,label:false});tag(g,'消息经过网关',960,363,{s:26,c:C.purple});
  for(const [x,right] of [[500,false],[1420,true]]){
    panel(g,x-400,405,800,425,{fill:C.paper,shadow:true});label(g,right?'被叫本地：入站控制消息':'主叫本地：创建会话',x,461,{s:32});
    screen(g,t,{x:x+(right?140:-140),y:245,role:right?'B':'A',uiText:'独立状态',roleLabel:false,scale:1.15});
    for(let j=0;j<2;j++)panel(g,x-335+j*155,555,130,110,{fill:C.paper,stroke:tint(C.ink,.4),r:16});
    panel(g,x+50,530,300,160,{fill:tint(right?C.amber:C.blue,.1)});label(g,'唯一工位',x+200,509,{s:30});
    const dt=t-(right?.8:4);if(dt>=0&&dt<2.4){const p=seg(dt,0,1.2);boxText(g,'任务',lerp(x-270,x+200,p),610,120,75,{s:28,fill:tint(C.green,.2)});}
    tag(g,'自己的队列 · 自己的状态',x,781,{s:28,c:right?C.amber:C.blue});
  }
}
const SUMMARY_TITLES=['先认会话','排完整过程','状态机管规则','超时留退路'];
function dockedSummary(g,i,opacity=1) {
  fade(g,opacity,()=>{const x=310+430*i;panel(g,x-180,185,360,170,{fill:C.paper,shadow:true});
    label(g,String(i+1).padStart(2,'0'),x-145,240,{s:38,w:900,f:'disp',a:'left',c:C.blue});
    label(g,SUMMARY_TITLES[i],x,309,{s:32,w:900});});
}
function drawSummary(g,t,index=0) {
  for(let i=0;i<index;i++)dockedSummary(g,i,index===3?1-seg(t,7.7,8):1);
  const dock=index===3?eio(seg(t,6,6.6)):eio(seg(t,7.7,8));
  fade(g,1-dock,()=>{
    panel(g,120,405,1680,425,{fill:C.paper,shadow:true});
    panel(g,120,405,160,115,{fill:C.blue,r:24});label(g,String(index+1).padStart(2,'0'),200,489,{s:72,w:900,f:'disp',c:C.paper});
    label(g,SUMMARY_TITLES[index],960,494,{s:60,w:900});
    if(index===0){
      const warning=t>=4&&t<4.65;
      arrow(g,t,{points:[[410,772],[1470,772]],tone:warning?'coral':'blue',blocked:warning,reveal:warning?.3:1});
      sessionKey(g,t,{x:warning?450:lerp(450,620,eio(seg(t,.4,1.2))),y:630,label:false});
      tag(g,'sessionId',450,711,{s:28,f:'mono'});sessionCard(g,t,{x:950,y:645,ready:!warning,matched:t>=1.2&&!warning});
      stateNode(g,t,{x:1450,y:645,width:400,height:140,label:'状态机',generic:true,current:!warning});
    }else if(index===1){
      panel(g,320,565,650,200,{fill:tint(C.blue,.07),stroke:C.blue});
      timerBar(g,t,{x:645,y:690,width:550,height:70,fill:t<4?seg(t,.4,3.6):1,label:'直到完成',fontSize:32});
      label(g,t<4?'本次任务':'下一项任务',645,616,{s:30,c:C.blue});
      message(g,t,{...MSG.terminate,sid:'S1',x:1430,y:655,opacity:t<4?1:1-seg(t,4,4.6)});
      arrow(g,t,{points:[[1240,655],[1010,655]],tone:'green',reveal:seg(t,4,4.6)});
    }else if(index===2){
      arrow(g,t,{points:[[450,655],[610,655]],tone:'blue',reveal:seg(t,.4,1.2)});
      arrow(g,t,{points:[[945,655],[1115,655]],tone:'green',reveal:seg(t,4,4.8)});
      boxText(g,'输入消息',310,655,240,110,{s:30});
      stateNode(g,t,{x:775,y:655,width:320,height:130,label:'当前',generic:true,current:t>=1.2&&t<4.8});
      stateNode(g,t,{x:1285,y:655,width:320,height:130,label:'下一步',generic:true,current:t>=4.8,tone:'green'});
      tag(g,'先把消息送到',1625,644,{s:26,c:C.blue});
      for(let j=0;j<3;j++)panel(g,1535+j*65,685,50,55,{fill:tint(C.blue,.1),r:9,lw:3});
    }else{
      clockFace(g,t,{x:535,y:637,r:72,text:'60 s',size:36});
      boxText(g,'完整处理工位',1355,637,490,120,{s:34,fill:t>=4?tint(C.green,.12):C.paper});
      arrow(g,t,{points:[[535,719],[535,754]],tone:'amber'});arrow(g,t,{points:[[1355,719],[1355,754]],tone:'green'});
      tag(g,'退出等待',535,800,{s:32,c:C.amber});tag(g,'接住取消',1355,800,{s:32,c:C.green});
    }
  });
  if(dock>0)dockedSummary(g,index,dock*(index===3?1-seg(t,7.7,8):1));
}
function drawReturn(g,t) {
  fade(g,1-seg(t,9.6,10),()=>{
    trio(g,t,{a:'已取消',b:'呼叫已结束'});states(g,t,'ENDED.SELF_TERMINATED','ENDED.OTHER_TERMINATED');
    if(t>=.4){symbol(g,t,{x:570,y:500,kind:'check',scale:.5});symbol(g,t,{x:1810,y:500,kind:'check',scale:.5});}
    panel(g,1370,615,410,110,{fill:tint(C.green,.1),stroke:C.green,r:24});
    tag(g,'完成托盘',1580,600,{s:26,c:C.green});
    line(g,[[1350,620],[1350,t>=7.2?595:720]],{w:10,c:t>=7.2?C.green:C.coral});
    message(g,t,{...MSG.terminate,x:lerp(1100,1580,eio(seg(t,7.2,7.8))),y:675});
    timerBar(g,t,{x:1270,y:792,width:700,height:84,fill:seg(t,4,4.6),label:'创建会话：约 50 ms'});
  });
}
function drawSeries(g,t) {
  const a=Math.min(seg(t,0,.2),1-seg(t,1.6,2));
  fade(g,a,()=>{
    screen(g,t,{x:390,y:560,scale:1.5,role:'A',uiText:'',roleLabel:false});
    screen(g,t,{x:1530,y:560,scale:1.5,role:'B',uiText:'',roleLabel:false});
    label(g,SERIES.title,960,530,{s:86,w:900});label(g,SERIES.sub,960,626,{s:40,c:C.blue});
    if(SERIES.next)label(g,SERIES.next,960,734,{s:30,c:C.purple});
  });
}
function drawCover(g,frame) {
  drawBackground(g,frame);
  // The whole story fits inside x=200..1720: safe for a centered 16:10 crop of 1920×1080.
  label(g,'取消去哪了',960,300,{s:146,w:900});label(g,'约50毫秒的会话竞态',960,395,{s:48,c:C.coral});
  screen(g,0,{x:480,y:590,scale:1.65,role:'A',uiText:'已取消',roleLabel:false});
  screen(g,0,{x:1440,y:590,scale:1.65,role:'B',uiText:'还在响',roleLabel:false,ringing:true});
  gateway(g,0,{x:960,y:580,scale:1.4,label:false});
  arrow(g,0,{points:[[480,795],[960,795],[1100,795]],dashed:true,blocked:true,tone:'coral'});
  sessionCard(g,0,{x:1390,y:820,ready:false,width:320});
  message(g,0,{...MSG.terminate,x:870,y:805});symbol(g,0,{x:1150,y:810,kind:'question',tone:'coral'});
  demoBadge(g,0,{x:1590,y:92,label:'机制演绎',width:280});
}
const DRAW=[drawOpening,drawTitle,drawRoute,drawHandshake,drawAccept,drawConfirm,drawRewind,drawGap,drawMatchMiss,drawLate,
  drawOwnership,drawRules,drawConcurrency,drawTimeout,drawChoice,drawQueue,drawCodeBoundary,drawFullBoundary,
  drawReplayInvite,drawReplayWait,drawReplayFinish,drawAligned,drawSeparate,
  (g,t)=>drawSummary(g,t,0),(g,t)=>drawSummary(g,t,1),(g,t)=>drawSummary(g,t,2),(g,t)=>drawSummary(g,t,3),drawReturn,drawSeries];
let lastChapter=-1;
Object.entries(SCRIPT).forEach(([id,scene],i)=>{
  if(scene.chapter!==lastChapter){film.chapter(scene.chapter,...CHAPTERS[scene.chapter]);lastChapter=scene.chapter;}
  film.addScene({id,...scene,draw:(g,t)=>DRAW[i](g,Math.round(t*1e9)/1e9)});
});
film.finish();
root.FILM_STYLE=Object.freeze({theme,fonts,fontsNeeded,ui:UI,script:SCRIPT,messages:MSG,layout:T,code:CODE,series:SERIES,chapters:CHAPTERS,
  primitives:Object.freeze({drawItems,screen,gateway,actionButton,bell,message,flight,pathAt,lanes,stateLabel,stateNode,stateArrow,
    arrow,retry,boundary,timerBar,ruler,sessionCard,sessionKey,queue,workstation,codeCard,compareCard,summaryCard,symbol,demoBadge,tag,clockFace}),
  hooks:Object.freeze({prepareStyle,drawBackground,drawChrome,drawCaptionBackground,drawCaption,drawCover}),chapterCard});
})(typeof window!=='undefined'?window:globalThis);
