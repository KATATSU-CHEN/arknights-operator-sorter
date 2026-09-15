# 明日方舟 · 干员排序器 (Arknights Operator Sorter)

仿照赛马娘角色 sorter 的玩法：从干员中选出候选，再通过一轮轮「二选一」的两两对比，
最终排出一份属于你的干员喜爱度榜单。

## 功能

- **选择页**：全部 429 名可获取干员，按**稀有度 / 职业 / 阵营**筛选、关键词搜索、一键预设（全选 / 仅六星 / 五星+六星 等）。
- **对比页**：每次展示两名干员，点击你更喜欢的一位；支持「势均力敌 / 都喜欢」（平局）、**撤销**、实时进度条，以及**头像 ↔ 精二立绘**切换。
  - 键盘快捷键：`←` 选左、`→` 选右、`↓` 或 `空格` 平局、`退格` 撤销。
- **结果页**：带并列名次的完整榜单 + **结果统计**（本命、最爱职业、平均稀有度，以及稀有度 / 职业 / 阵营分布图）；可复制榜单文本、生成分享链接、打印 / 存 PDF。
- **分享预览**：内置 Open Graph / Twitter Card 信息与阿米娅图标，分享链接在社交软件里会显示标题与缩略图。
- 排序算法为**交互式归并排序**（用户充当比较器），对比次数不超过 `n·log₂n` 的最坏上界，并用并查集处理平局的等价名次；进度条按确定性的「元素归位数」度量，平滑且结束时恰为 100%。

## 目录结构

```
sorter/
├─ index.html          # 页面结构（选择 / 对比 / 结果三个视图）
├─ style.css           # 样式（深色方舟风）
├─ app.js              # UI 逻辑与视图控制
├─ sorter-core.js      # 排序引擎（浏览器 + Node 通用，可单测）
├─ data/operators.js   # 自动生成的干员数据（含头像 CDN 前缀）
└─ scripts/
   ├─ build-operators.mjs  # 拉取并生成干员数据
   ├─ serve.mjs            # 零依赖本地静态服务器
   └─ test-sorter.mjs      # 排序引擎测试
```

## 使用

直接双击打开 `index.html` 即可使用（数据已内联进 `data/operators.js`）。
若浏览器对 `file://` 有限制，建议用本地服务器：

```bash
cd sorter
npm run serve      # http://localhost:5173
```

### 更新干员数据

```bash
npm run build-data # 重新拉取最新干员列表 -> data/operators.js
```

### 运行测试

```bash
npm test           # 校验排序引擎的正确性、平局并列、撤销回滚
```

## 数据与致谢

- 干员名称：[Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)（zh_CN）
- 干员头像：[yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)（经 jsDelivr CDN 加载）

本页为粉丝制作，与鹰角网络无关。
