/* 第 2 轮改画面之前，从实际 FILM 对象导出的不可变基线。 */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {load}=require('./film.test.cjs');
const BEFORE={
  "W": 1920,
  "H": 1080,
  "FPS": 30,
  "duration": 338,
  "scenes": [
    {
      "id": "s01",
      "chap": 0,
      "start": 0,
      "d": 15
    },
    {
      "id": "s02",
      "chap": 1,
      "start": 15,
      "d": 7
    },
    {
      "id": "s03",
      "chap": 2,
      "start": 22,
      "d": 12
    },
    {
      "id": "s04",
      "chap": 2,
      "start": 34,
      "d": 13
    },
    {
      "id": "s05",
      "chap": 2,
      "start": 47,
      "d": 14
    },
    {
      "id": "s06",
      "chap": 2,
      "start": 61,
      "d": 13
    },
    {
      "id": "s07",
      "chap": 3,
      "start": 74,
      "d": 12
    },
    {
      "id": "s08",
      "chap": 3,
      "start": 86,
      "d": 14
    },
    {
      "id": "s09",
      "chap": 3,
      "start": 100,
      "d": 14
    },
    {
      "id": "s10",
      "chap": 3,
      "start": 114,
      "d": 14
    },
    {
      "id": "s11",
      "chap": 4,
      "start": 128,
      "d": 12
    },
    {
      "id": "s12",
      "chap": 4,
      "start": 140,
      "d": 12
    },
    {
      "id": "s13",
      "chap": 4,
      "start": 152,
      "d": 12
    },
    {
      "id": "s14",
      "chap": 4,
      "start": 164,
      "d": 12
    },
    {
      "id": "s15",
      "chap": 5,
      "start": 176,
      "d": 14
    },
    {
      "id": "s16",
      "chap": 5,
      "start": 190,
      "d": 14
    },
    {
      "id": "s17",
      "chap": 5,
      "start": 204,
      "d": 14
    },
    {
      "id": "s18",
      "chap": 5,
      "start": 218,
      "d": 14
    },
    {
      "id": "s19",
      "chap": 6,
      "start": 232,
      "d": 12
    },
    {
      "id": "s20",
      "chap": 6,
      "start": 244,
      "d": 12
    },
    {
      "id": "s21",
      "chap": 6,
      "start": 256,
      "d": 13
    },
    {
      "id": "s22",
      "chap": 6,
      "start": 269,
      "d": 13
    },
    {
      "id": "s23",
      "chap": 6,
      "start": 282,
      "d": 12
    },
    {
      "id": "s24",
      "chap": 7,
      "start": 294,
      "d": 8
    },
    {
      "id": "s25",
      "chap": 7,
      "start": 302,
      "d": 8
    },
    {
      "id": "s26",
      "chap": 7,
      "start": 310,
      "d": 8
    },
    {
      "id": "s27",
      "chap": 7,
      "start": 318,
      "d": 8
    },
    {
      "id": "s28",
      "chap": 8,
      "start": 326,
      "d": 10
    },
    {
      "id": "s29",
      "chap": 9,
      "start": 336,
      "d": 2
    }
  ],
  "captions": [
    {
      "t0": 0,
      "t1": 3.6,
      "text": "我这边，已经{取消}了",
      "plain": "我这边，已经取消了"
    },
    {
      "t0": 3.6,
      "t1": 7.2,
      "text": "对面，怎么[还在响]",
      "plain": "对面，怎么还在响"
    },
    {
      "t0": 7.2,
      "t1": 11,
      "text": "问题藏在^约50毫秒^里",
      "plain": "问题藏在约50毫秒里"
    },
    {
      "t0": 11,
      "t1": 15,
      "text": "那条{取消消息}，去哪了",
      "plain": "那条取消消息，去哪了"
    },
    {
      "t0": 15,
      "t1": 19.8,
      "text": "Kotlin 实现 SIP 通信协议",
      "plain": "Kotlin 实现 SIP 通信协议"
    },
    {
      "t0": 19.8,
      "t1": 22,
      "text": "先排队，再开口",
      "plain": "先排队，再开口"
    },
    {
      "t0": 22,
      "t1": 26,
      "text": "工作上，要做一个{语音通话}",
      "plain": "工作上，要做一个语音通话"
    },
    {
      "t0": 26,
      "t1": 30,
      "text": "数据走{网关}，它替代了{代理服务器}",
      "plain": "数据走网关，它替代了代理服务器"
    },
    {
      "t0": 30,
      "t1": 34,
      "text": "通话怎么建立，得{自己实现}",
      "plain": "通话怎么建立，得自己实现"
    },
    {
      "t0": 34,
      "t1": 38.2,
      "text": "我先发出一条{邀请}",
      "plain": "我先发出一条邀请"
    },
    {
      "t0": 38.2,
      "t1": 42.6,
      "text": "对面回一句：{我开始响铃了}",
      "plain": "对面回一句：我开始响铃了"
    },
    {
      "t0": 42.6,
      "t1": 47,
      "text": "收到回音，我就{停止重发}",
      "plain": "收到回音，我就停止重发"
    },
    {
      "t0": 47,
      "t1": 51.4,
      "text": "对面点了{接听}",
      "plain": "对面点了接听"
    },
    {
      "t0": 51.4,
      "t1": 56,
      "text": "我收到消息，先进入{通话}",
      "plain": "我收到消息，先进入通话"
    },
    {
      "t0": 56,
      "t1": 61,
      "text": "可对面，还在{准备状态}",
      "plain": "可对面，还在准备状态"
    },
    {
      "t0": 61,
      "t1": 65,
      "text": "还差最后一条{确认}",
      "plain": "还差最后一条确认"
    },
    {
      "t0": 65,
      "t1": 69.4,
      "text": "对面收到，才进入{通话}",
      "plain": "对面收到，才进入通话"
    },
    {
      "t0": 69.4,
      "t1": 74,
      "text": "两边的状态，靠{消息}对齐",
      "plain": "两边的状态，靠消息对齐"
    },
    {
      "t0": 74,
      "t1": 78,
      "text": "接通的路，先看到这里",
      "plain": "接通的路，先看到这里"
    },
    {
      "t0": 78,
      "t1": 82,
      "text": "如果{取消}来得更早呢",
      "plain": "如果取消来得更早呢"
    },
    {
      "t0": 82,
      "t1": 86,
      "text": "就在被叫{创建会话}的时候",
      "plain": "就在被叫创建会话的时候"
    },
    {
      "t0": 86,
      "t1": 90.6,
      "text": "创建会话，大概需要^50毫秒^",
      "plain": "创建会话，大概需要50毫秒"
    },
    {
      "t0": 90.6,
      "t1": 95.2,
      "text": "偏偏这时候，{取消}先到了",
      "plain": "偏偏这时候，取消先到了"
    },
    {
      "t0": 95.2,
      "t1": 100,
      "text": "消息到了，会话还[没建好]",
      "plain": "消息到了，会话还没建好"
    },
    {
      "t0": 100,
      "t1": 104.6,
      "text": "它得先找到{自己的会话}",
      "plain": "它得先找到自己的会话"
    },
    {
      "t0": 104.6,
      "t1": 109.2,
      "text": "找不到，又不是{邀请}",
      "plain": "找不到，又不是邀请"
    },
    {
      "t0": 109.2,
      "t1": 114,
      "text": "于是，只留下了一条[日志]",
      "plain": "于是，只留下了一条日志"
    },
    {
      "t0": 114,
      "t1": 118.6,
      "text": "会话终于建好了",
      "plain": "会话终于建好了"
    },
    {
      "t0": 118.6,
      "t1": 123.2,
      "text": "它开始{响铃}，取消却没了",
      "plain": "它开始响铃，取消却没了"
    },
    {
      "t0": 123.2,
      "t1": 128,
      "text": "我结束了，对面还在[等接听]",
      "plain": "我结束了，对面还在等接听"
    },
    {
      "t0": 128,
      "t1": 132,
      "text": "消息不是直接丢给{状态机}",
      "plain": "消息不是直接丢给状态机"
    },
    {
      "t0": 132,
      "t1": 136,
      "text": "先用{会话标识}，找到归属",
      "plain": "先用会话标识，找到归属"
    },
    {
      "t0": 136,
      "t1": 140,
      "text": "匹配上，才轮到{状态转移}",
      "plain": "匹配上，才轮到状态转移"
    },
    {
      "t0": 140,
      "t1": 144,
      "text": "状态机知道{怎么结束}",
      "plain": "状态机知道怎么结束"
    },
    {
      "t0": 144,
      "t1": 148,
      "text": "被叫收到取消，就能{结束}",
      "plain": "被叫收到取消，就能结束"
    },
    {
      "t0": 148,
      "t1": 152,
      "text": "可刚才，消息根本[没进来]",
      "plain": "可刚才，消息根本没进来"
    },
    {
      "t0": 152,
      "t1": 156,
      "text": "坑在{创建}和{处理}之间",
      "plain": "坑在创建和处理之间"
    },
    {
      "t0": 156,
      "t1": 160,
      "text": "上一件还没做完，下一件就来了",
      "plain": "上一件还没做完，下一件就来了"
    },
    {
      "t0": 160,
      "t1": 164,
      "text": "先后顺序，被[并发]打乱了",
      "plain": "先后顺序，被并发打乱了"
    },
    {
      "t0": 164,
      "t1": 168,
      "text": "最后，还有^60秒^兜底",
      "plain": "最后，还有60秒兜底"
    },
    {
      "t0": 168,
      "t1": 172,
      "text": "到点，本地产生{超时消息}",
      "plain": "到点，本地产生超时消息"
    },
    {
      "t0": 172,
      "t1": 176,
      "text": "但这救不了[丢掉的取消]",
      "plain": "但这救不了丢掉的取消"
    },
    {
      "t0": 176,
      "t1": 179.6,
      "text": "我需要让处理过程{排队}",
      "plain": "我需要让处理过程排队"
    },
    {
      "t0": 179.6,
      "t1": 183,
      "text": "候选有{加锁}、{同步屏障}、{Flow}",
      "plain": "候选有加锁、同步屏障、Flow"
    },
    {
      "t0": 183,
      "t1": 186.4,
      "text": "最后，我选了{Flow}",
      "plain": "最后，我选了Flow"
    },
    {
      "t0": 186.4,
      "t1": 190,
      "text": "理由很朴素：{好懂，好维护}",
      "plain": "理由很朴素：好懂，好维护"
    },
    {
      "t0": 190,
      "t1": 193.6,
      "text": "消息先进入{同一条队列}",
      "plain": "消息先进入同一条队列"
    },
    {
      "t0": 193.6,
      "t1": 197,
      "text": "前一个{做完}，才取下一个",
      "plain": "前一个做完，才取下一个"
    },
    {
      "t0": 197,
      "t1": 200.4,
      "text": "创建会话，也算这一步",
      "plain": "创建会话，也算这一步"
    },
    {
      "t0": 200.4,
      "t1": 204,
      "text": "这样，取消就不会{抢跑}",
      "plain": "这样，取消就不会抢跑"
    },
    {
      "t0": 204,
      "t1": 208.6,
      "text": "关键，是这一步{处理完成}",
      "plain": "关键，是这一步处理完成"
    },
    {
      "t0": 208.6,
      "t1": 213.2,
      "text": "会话建好，才结束本次处理",
      "plain": "会话建好，才结束本次处理"
    },
    {
      "t0": 213.2,
      "t1": 218,
      "text": "下一条消息，再交给会话",
      "plain": "下一条消息，再交给会话"
    },
    {
      "t0": 218,
      "t1": 221.6,
      "text": "注意，我说的是{处理完}",
      "plain": "注意，我说的是处理完"
    },
    {
      "t0": 221.6,
      "t1": 225,
      "text": "只把启动动作排队，[不够]",
      "plain": "只把启动动作排队，不够"
    },
    {
      "t0": 225,
      "t1": 228.4,
      "text": "活儿没做完，坑就还在",
      "plain": "活儿没做完，坑就还在"
    },
    {
      "t0": 228.4,
      "t1": 232,
      "text": "队列要等到{会话可用了}",
      "plain": "队列要等到会话可用了"
    },
    {
      "t0": 232,
      "t1": 236,
      "text": "现在，把那两条消息{再放一遍}",
      "plain": "现在，把那两条消息再放一遍"
    },
    {
      "t0": 236,
      "t1": 240,
      "text": "邀请先到，开始{创建会话}",
      "plain": "邀请先到，开始创建会话"
    },
    {
      "t0": 240,
      "t1": 244,
      "text": "这一步结束前，{不取下一条}",
      "plain": "这一步结束前，不取下一条"
    },
    {
      "t0": 244,
      "t1": 248,
      "text": "取消，还是{提前到了}",
      "plain": "取消，还是提前到了"
    },
    {
      "t0": 248,
      "t1": 252,
      "text": "这回，它被{留在队列里}",
      "plain": "这回，它被留在队列里"
    },
    {
      "t0": 252,
      "t1": 256,
      "text": "它没有撞上[半成品会话]",
      "plain": "它没有撞上半成品会话"
    },
    {
      "t0": 256,
      "t1": 260.2,
      "text": "会话建好，先进入{响铃}",
      "plain": "会话建好，先进入响铃"
    },
    {
      "t0": 260.2,
      "t1": 264.6,
      "text": "再取取消，这次{找得到会话}",
      "plain": "再取取消，这次找得到会话"
    },
    {
      "t0": 264.6,
      "t1": 269,
      "text": "于是，立刻{结束这次呼叫}",
      "plain": "于是，立刻结束这次呼叫"
    },
    {
      "t0": 269,
      "t1": 273.2,
      "text": "我取消了，你也{结束了}",
      "plain": "我取消了，你也结束了"
    },
    {
      "t0": 273.2,
      "t1": 277.6,
      "text": "状态名不同，结果终于{对上了}",
      "plain": "状态名不同，结果终于对上了"
    },
    {
      "t0": 277.6,
      "t1": 282,
      "text": "补上的，是{本地处理顺序}",
      "plain": "补上的，是本地处理顺序"
    },
    {
      "t0": 282,
      "t1": 286,
      "text": "被叫收消息，要{按顺序处理}",
      "plain": "被叫收消息，要按顺序处理"
    },
    {
      "t0": 286,
      "t1": 290,
      "text": "主叫建会话，也要{串行化}",
      "plain": "主叫建会话，也要串行化"
    },
    {
      "t0": 290,
      "t1": 294,
      "text": "两块屏，仍是{各管各的状态}",
      "plain": "两块屏，仍是各管各的状态"
    },
    {
      "t0": 294,
      "t1": 298,
      "text": "先确认：消息{属于哪个会话}",
      "plain": "先确认：消息属于哪个会话"
    },
    {
      "t0": 298,
      "t1": 302,
      "text": "会话还没好，消息就[可能丢]",
      "plain": "会话还没好，消息就可能丢"
    },
    {
      "t0": 302,
      "t1": 306,
      "text": "要排队的，是{完整处理过程}",
      "plain": "要排队的，是完整处理过程"
    },
    {
      "t0": 306,
      "t1": 310,
      "text": "处理完一条，再处理下一条",
      "plain": "处理完一条，再处理下一条"
    },
    {
      "t0": 310,
      "t1": 314,
      "text": "状态机定义{收到后怎么办}",
      "plain": "状态机定义收到后怎么办"
    },
    {
      "t0": 314,
      "t1": 318,
      "text": "顺序对了，规则才有机会生效",
      "plain": "顺序对了，规则才有机会生效"
    },
    {
      "t0": 318,
      "t1": 322,
      "text": "每条等待，都要有{退出办法}",
      "plain": "每条等待，都要有退出办法"
    },
    {
      "t0": 322,
      "t1": 326,
      "text": "超时能兜底，{不能代替正确顺序}",
      "plain": "超时能兜底，不能代替正确顺序"
    },
    {
      "t0": 326,
      "t1": 330,
      "text": "那条{取消}，这回有人接住了",
      "plain": "那条取消，这回有人接住了"
    },
    {
      "t0": 330,
      "t1": 333.2,
      "text": "这^约50毫秒^，不用变快",
      "plain": "这约50毫秒，不用变快"
    },
    {
      "t0": 333.2,
      "t1": 336,
      "text": "只要让它{做完}",
      "plain": "只要让它做完"
    },
    {
      "t0": 336,
      "t1": 338,
      "text": "工作档案",
      "plain": "工作档案"
    }
  ],
  "cues": [
    {
      "t": 0.4,
      "type": "ring",
      "v": 1
    },
    {
      "t": 3.6,
      "type": "error",
      "v": 1
    },
    {
      "t": 4,
      "type": "ring",
      "v": 1
    },
    {
      "t": 14.7,
      "type": "whoosh",
      "v": 1
    },
    {
      "t": 15,
      "type": "whoosh",
      "v": 1
    },
    {
      "t": 26,
      "type": "send",
      "v": 1
    },
    {
      "t": 35,
      "type": "send",
      "v": 1
    },
    {
      "t": 38,
      "type": "ring",
      "v": 1
    },
    {
      "t": 38.4,
      "type": "send",
      "v": 1
    },
    {
      "t": 47.4,
      "type": "latch",
      "v": 1
    },
    {
      "t": 50.2,
      "type": "send",
      "v": 1
    },
    {
      "t": 61.3,
      "type": "send",
      "v": 1
    },
    {
      "t": 62.5,
      "type": "success",
      "v": 1
    },
    {
      "t": 74,
      "type": "whoosh",
      "v": 1
    },
    {
      "t": 76.8,
      "type": "send",
      "v": 1
    },
    {
      "t": 90.6,
      "type": "send",
      "v": 1
    },
    {
      "t": 95.2,
      "type": "error",
      "v": 1
    },
    {
      "t": 100.4,
      "type": "send",
      "v": 1
    },
    {
      "t": 109.2,
      "type": "error",
      "v": 1
    },
    {
      "t": 114.8,
      "type": "ring",
      "v": 1
    },
    {
      "t": 115,
      "type": "send",
      "v": 1
    },
    {
      "t": 132,
      "type": "latch",
      "v": 1
    },
    {
      "t": 141.2,
      "type": "latch",
      "v": 1
    },
    {
      "t": 145.2,
      "type": "success",
      "v": 1
    },
    {
      "t": 156,
      "type": "error",
      "v": 1
    },
    {
      "t": 164.4,
      "type": "tick",
      "v": 1
    },
    {
      "t": 167.8,
      "type": "tick",
      "v": 1
    },
    {
      "t": 168,
      "type": "send",
      "v": 1
    },
    {
      "t": 176.4,
      "type": "whoosh",
      "v": 1
    },
    {
      "t": 183,
      "type": "latch",
      "v": 1
    },
    {
      "t": 190.4,
      "type": "tick",
      "v": 1
    },
    {
      "t": 190.8,
      "type": "tick",
      "v": 1
    },
    {
      "t": 192,
      "type": "latch",
      "v": 1
    },
    {
      "t": 208.6,
      "type": "latch",
      "v": 1
    },
    {
      "t": 221.6,
      "type": "error",
      "v": 1
    },
    {
      "t": 230,
      "type": "latch",
      "v": 1
    },
    {
      "t": 232.4,
      "type": "send",
      "v": 1
    },
    {
      "t": 234.6,
      "type": "latch",
      "v": 1
    },
    {
      "t": 244.4,
      "type": "latch",
      "v": 1
    },
    {
      "t": 244.6,
      "type": "send",
      "v": 1
    },
    {
      "t": 257,
      "type": "ring",
      "v": 1
    },
    {
      "t": 257,
      "type": "send",
      "v": 1
    },
    {
      "t": 260.2,
      "type": "latch",
      "v": 1
    },
    {
      "t": 264.6,
      "type": "success",
      "v": 1
    },
    {
      "t": 269.4,
      "type": "success",
      "v": 1
    },
    {
      "t": 277.6,
      "type": "tick",
      "v": 1
    },
    {
      "t": 278.3,
      "type": "tick",
      "v": 1
    },
    {
      "t": 279,
      "type": "tick",
      "v": 1
    },
    {
      "t": 286,
      "type": "latch",
      "v": 1
    },
    {
      "t": 294.4,
      "type": "latch",
      "v": 1
    },
    {
      "t": 306,
      "type": "latch",
      "v": 1
    },
    {
      "t": 310.4,
      "type": "send",
      "v": 1
    },
    {
      "t": 314.8,
      "type": "success",
      "v": 1
    },
    {
      "t": 318.4,
      "type": "tick",
      "v": 1
    },
    {
      "t": 322,
      "type": "latch",
      "v": 1
    },
    {
      "t": 326.4,
      "type": "success",
      "v": 1
    },
    {
      "t": 333.2,
      "type": "latch",
      "v": 1
    }
  ],
  "chapters": [
    {
      "t": 0,
      "n": 0
    },
    {
      "t": 15,
      "n": 1
    },
    {
      "t": 22,
      "n": 2
    },
    {
      "t": 74,
      "n": 3
    },
    {
      "t": 128,
      "n": 4
    },
    {
      "t": 176,
      "n": 5
    },
    {
      "t": 232,
      "n": 6
    },
    {
      "t": 294,
      "n": 7
    },
    {
      "t": 326,
      "n": 8
    },
    {
      "t": 336,
      "n": 9
    }
  ],
  "chapterInfo": [
    {
      "t": 0,
      "n": 0,
      "zh": "开场｜取消去哪了",
      "en": "WHERE DID CANCEL GO",
      "desc": "按机制构造的两端不一致：取消消息悬在创建窗口外。"
    },
    {
      "t": 15,
      "n": 1,
      "zh": "Kotlin 实现 SIP 通信协议",
      "en": "A SIP-STYLE PROTOCOL IN KOTLIN",
      "desc": "先排队，再开口。"
    },
    {
      "t": 22,
      "n": 2,
      "zh": "第一章｜接通，原来这么麻烦",
      "en": "THE CALL BEGINS",
      "desc": "邀请、响铃、接听和确认；两块屏靠消息对齐各自的状态。"
    },
    {
      "t": 74,
      "n": 3,
      "zh": "第二章｜取消，掉进了缝里",
      "en": "THE CREATION GAP",
      "desc": "约 50 ms 创建窗口里，构造的取消先到，因会话未匹配而忽略。"
    },
    {
      "t": 128,
      "n": 4,
      "zh": "第三章｜状态机，背不了这锅",
      "en": "BEFORE THE STATE MACHINE",
      "desc": "会话匹配在状态转移之前；响铃超时只能兜底。"
    },
    {
      "t": 176,
      "n": 5,
      "zh": "第四章｜先排队，别抢跑",
      "en": "ONE AT A TIME",
      "desc": "同一条本地处理链逐项完成，会话创建必须包含在本次处理内。"
    },
    {
      "t": 232,
      "n": 6,
      "zh": "第五章｜这回，终于接住了",
      "en": "CANCEL FINALLY ARRIVES",
      "desc": "重放同一构造案例：创建完成后再处理取消；两端仍各管各的状态。"
    },
    {
      "t": 294,
      "n": 7,
      "zh": "总结｜这次记住四件事",
      "en": "KEEP THE FOUR RULES",
      "desc": "先认会话、排完整过程、状态机管规则、超时留退路。"
    },
    {
      "t": 326,
      "n": 8,
      "zh": "结尾｜把那条取消接住",
      "en": "LET IT FINISH",
      "desc": "无需虚构创建变快，让完整处理先做完。"
    },
    {
      "t": 336,
      "n": 9,
      "zh": "系列片尾",
      "en": "WORK ARCHIVE",
      "desc": "工作档案：把做过的设计，讲成故事。"
    }
  ],
  "fontsNeeded": [
    "500 32px \"FCJK\"",
    "700 32px \"FCJK\"",
    "900 32px \"FCJK\"",
    "800 32px \"FDisp\"",
    "900 32px \"FDisp\"",
    "500 32px \"FSup\"",
    "700 32px \"FSup\"",
    "900 32px \"FSup\"",
    "400 32px \"FMono\"",
    "400 32px \"FMonoCJK\"",
    "700 32px \"FMono\"",
    "700 32px \"FMonoCJK\""
  ]
};
const LOCKED={
  "audio.py": "22b1b3c69fb4a3b8cdb61d08a1226fa0dfff701700b9bd086838ce486d6ca445",
  "audio.wav": "8bc9c28e351284e541081b01de7f08b4047828d941222d37c293a345dda80cca",
  "film.html": "1a1a6db9b04daa3addcf2d5c2c1da5ea48c703f91e2589f9a1cc0f782a2a3945",
  "timeline.json": "5cb1b292423a4235e74881418b996325deed770de6b8be76584ac7368cc4dc3b",
  "render.json": "6f2276f35719decd63f6f2d5e5360ed0d04d64d52b2c2a1c765584a4931c8761"
};
const SCRIPT_HASH="8753a1b119c496138e9c1a660b93bc303bc3333f8a428a6aad4c42bcc76b0070";
const FIRST_LINE="/* Kotlin 实现 SIP 通信协议｜扁平 MG 风格包与完整 29 幕。";
const UI_TITLE="Kotlin 实现 SIP 通信协议";
function hash(s){return createHash('sha256').update(s).digest('hex');}
function verify(){
 const {FILM,FILM_STYLE}=load(),after=JSON.parse(JSON.stringify(FILM));
 assert.deepEqual(after,BEFORE,'导出的时间线发生变化');
 const src=fs.readFileSync(path.join(__dirname,'film.js'),'utf8');
 assert.equal(hash(src.slice(src.indexOf('const SCRIPT ='),src.indexOf('// 全片唯一允许的上屏代码'))),SCRIPT_HASH,'SCRIPT 原文发生变化');
 assert.equal(src.split('\n')[0],FIRST_LINE);assert.equal(FILM_STYLE.ui.title,UI_TITLE);
 for(const [file,sha]of Object.entries(LOCKED))assert.equal(hash(fs.readFileSync(path.join(__dirname,file))),sha,file+' 被改动');
 return {duration:after.duration,scenes:after.scenes.length,captions:after.captions.length,cues:after.cues.length,sha256:hash(JSON.stringify(after)),differences:0};
}
if(require.main===module){
 if(process.argv.includes('--export-before'))console.log(JSON.stringify(BEFORE,null,2));
 else if(process.argv.includes('--export-after'))console.log(JSON.stringify(load().FILM,null,2));
 else if(process.argv.includes('--compare-browser')){
  const file=process.argv[process.argv.indexOf('--compare-browser')+1];
  assert.ok(file,'--compare-browser 需要真实页面导出的 JSON 路径，或 -（stdin）');
  const browser=JSON.parse(fs.readFileSync(file==='-'?0:file,'utf8'));
  for(const key of ['duration','scenes','captions','cues','chapters'])assert.deepEqual(browser[key],BEFORE[key],`浏览器时间线 ${key} 发生变化`);
  console.log('浏览器导出与改前基线：338 秒 / 29 幕 / 84 字幕 / 57 cue / 10 章节，差异 0。');
 }
 else console.log(JSON.stringify(verify(),null,2));
}
module.exports={verify,BEFORE};
