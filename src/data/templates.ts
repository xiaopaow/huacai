export interface InspirationTemplate {
  id: string;
  type: "白底图" | "卖点图" | "场景图" | "尺寸图" | "细节图";
  category: "日用百货" | "家居家装";
  layout: "方形" | "横版" | "竖版";
  aspectRatio: "1:1" | "16:9" | "3:4";
  title: string;
  prompt: string;
  imageUrl: string;
}

const image = (id: string) => `https://cos.huotu333.cn/templates/${id}.webp`;

export const inspirationTemplates: InspirationTemplate[] = [
  { id: "insp-001", type: "白底图", category: "日用百货", layout: "方形", aspectRatio: "1:1", title: "保温杯白底主图", prompt: "纯白无缝背景，磨砂不锈钢保温杯居中直立，柔和影棚光，商品占画面约 70%，边缘清晰，无文字与道具。", imageUrl: image("insp-001") },
  { id: "insp-002", type: "白底图", category: "日用百货", layout: "竖版", aspectRatio: "3:4", title: "折叠伞白底主图", prompt: "竖版纯白背景，藏青色折叠自动伞半撑开居中展示，伞骨清晰，柔和顶光与侧光，保留浅淡接地阴影。", imageUrl: image("insp-002") },
  { id: "insp-003", type: "卖点图", category: "日用百货", layout: "竖版", aspectRatio: "3:4", title: "免打孔挂钩卖点图", prompt: "浅灰白背景，透明吸盘挂钩与毛巾展示承重场景，突出免打孔、承重能力两个卖点，版式克制清晰。", imageUrl: image("insp-003") },
  { id: "insp-004", type: "卖点图", category: "日用百货", layout: "横版", aspectRatio: "16:9", title: "冰箱收纳盒卖点图", prompt: "横版米白背景，透明收纳盒置于左侧，右侧突出分格保鲜、加厚防摔和可叠放卖点，原木米色与墨绿配色。", imageUrl: image("insp-004") },
  { id: "insp-005", type: "场景图", category: "日用百货", layout: "横版", aspectRatio: "16:9", title: "香薰蜡烛居家场景", prompt: "温馨卧室床头柜场景，磨砂玻璃香薰蜡烛为焦点，搭配暖色台灯、书本和针织毯，傍晚柔光，无文字。", imageUrl: image("insp-005") },
  { id: "insp-006", type: "场景图", category: "日用百货", layout: "方形", aspectRatio: "1:1", title: "厨房抹布场景图", prompt: "明亮厨房台面，一只手使用棉麻抹布擦拭水迹，侧窗晨光，白、原麻与淡绿色调，真实自然。", imageUrl: image("insp-006") },
  { id: "insp-007", type: "尺寸图", category: "日用百货", layout: "横版", aspectRatio: "16:9", title: "无痕衣架尺寸图", prompt: "浅灰白背景，衣架正侧两个视角，使用规整箭头标出宽度、高度与防滑槽尺寸，深灰线条配品牌色数值。", imageUrl: image("insp-007") },
  { id: "insp-008", type: "尺寸图", category: "日用百货", layout: "方形", aspectRatio: "1:1", title: "保鲜盒尺寸对照图", prompt: "纯白背景，三个规格保鲜盒阶梯排列，分别标注容量和尺寸，湖蓝色数值，版式整洁专业。", imageUrl: image("insp-008") },
  { id: "insp-009", type: "细节图", category: "日用百货", layout: "方形", aspectRatio: "1:1", title: "毛巾纹理细节图", prompt: "纯棉毛巾微距特写，清晰展示蓬松割绒纤维与厚度，柔和侧逆光，米白与浅杏色，无文字。", imageUrl: image("insp-009") },
  { id: "insp-010", type: "细节图", category: "日用百货", layout: "竖版", aspectRatio: "3:4", title: "马克杯釉面细节图", prompt: "哑光陶瓷马克杯杯口与把手衔接处微距特写，突出磨砂釉面、弧度和做工，低饱和蓝灰色调。", imageUrl: image("insp-010") },
  { id: "insp-011", type: "白底图", category: "家居家装", layout: "方形", aspectRatio: "1:1", title: "陶瓷加湿器白底主图", prompt: "纯白无缝背景，奶白陶瓷香薰加湿器与原木顶盖居中，双侧柔光，保留极淡接地阴影，无文字道具。", imageUrl: image("insp-011") },
  { id: "insp-012", type: "白底图", category: "家居家装", layout: "竖版", aspectRatio: "3:4", title: "金属置物架白底图", prompt: "竖版纯白背景，四层黑色金属与胡桃木置物架完整入画，均匀影棚光，木纹清晰，极简高级。", imageUrl: image("insp-012") },
  { id: "insp-013", type: "卖点图", category: "家居家装", layout: "竖版", aspectRatio: "3:4", title: "记忆棉枕卖点竖图", prompt: "浅米色床品场景，人体工学记忆棉枕为主体，以细引线突出慢回弹与护颈曲线，排版清晰克制。", imageUrl: image("insp-013") },
  { id: "insp-014", type: "卖点图", category: "家居家装", layout: "横版", aspectRatio: "16:9", title: "保温壶卖点横图", prompt: "横版高级卖点图，左侧磨砂保温壶，右侧突出长效保温和食品级内胆，深墨绿与浅金配色。", imageUrl: image("insp-014") },
  { id: "insp-015", type: "场景图", category: "家居家装", layout: "横版", aspectRatio: "16:9", title: "布艺沙发客厅场景图", prompt: "明亮北欧客厅，浅燕麦色布艺沙发为主体，落地窗晨光、原木茶几和绿植，真实松弛，无文字。", imageUrl: image("insp-015") },
  { id: "insp-016", type: "场景图", category: "家居家装", layout: "方形", aspectRatio: "1:1", title: "床品四件套卧室场景", prompt: "温馨卧室，浅豆沙色全棉四件套铺在木床上，纱帘晨光与陶瓷台灯营造柔软舒适氛围。", imageUrl: image("insp-016") },
  { id: "insp-017", type: "尺寸图", category: "家居家装", layout: "横版", aspectRatio: "16:9", title: "岩板餐桌尺寸图", prompt: "浅灰白背景，现代岩板餐桌侧前视角，规整标出长度、宽度与高度，黑白灰专业规格图风格。", imageUrl: image("insp-017") },
  { id: "insp-018", type: "尺寸图", category: "家居家装", layout: "方形", aspectRatio: "1:1", title: "遮光窗帘尺寸对照图", prompt: "浅米白背景，加厚遮光窗帘居中，标出宽高并附规格对照表，雾灰与深灰色调，工整易读。", imageUrl: image("insp-018") },
  { id: "insp-019", type: "细节图", category: "家居家装", layout: "方形", aspectRatio: "1:1", title: "羊毛地毯材质细节图", prompt: "羊毛混纺地毯微距，柔软短绒根根分明，低角度侧光表现厚实层次，米驼与浅灰交织，无文字。", imageUrl: image("insp-019") },
  { id: "insp-020", type: "细节图", category: "家居家装", layout: "竖版", aspectRatio: "3:4", title: "实木柜做工细节图", prompt: "实木抽屉柜榫卯与金属滑轨微距特写，突出自然木纹、燕尾榫和黄铜拉手，温暖侧逆光。", imageUrl: image("insp-020") },
];
