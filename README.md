# 光伏出力预警系统 (Photovoltaic Output Early Warning System)

上海金山地区光伏出力骤降预警系统，基于气象数据预测因天气变化（云层、降雨、雾霾等）导致的光伏发电出力骤降，提前预警以减少对电网的冲击。

## 项目背景

上海金山地区分布式光伏装机容量持续增长，光伏出力受气象条件影响显著。当云层快速移动、突发降雨或雾霾加重时，光伏出力可能在短时间内骤降，对电网调度和稳定运行带来挑战。本系统旨在提供提前预警，帮助电网调度人员做好应对准备。

## 核心功能

- **气象数据采集**：对接气象API，获取上海金山地区实时及预报气象数据（辐照度、云量、降水概率等）
- **光伏出力预测**：基于气象数据和历史出力数据，预测未来数小时光伏出力曲线
- **骤降预警**：检测出力骤降风险，按严重程度分级预警（蓝/黄/橙/红）
- **可视化仪表盘**：实时展示光伏出力、气象数据、预警信息
- **预警推送**：通过多渠道（Web、短信、邮件）推送预警通知

## 技术架构

```
┌─────────────────────────────────────────────────┐
│                 前端展示层 (React)                │
│         仪表盘 / 预警面板 / 历史分析              │
├─────────────────────────────────────────────────┤
│               后端服务层 (Python/FastAPI)         │
│    气象采集 / 出力预测 / 预警引擎 / 通知服务      │
├─────────────────────────────────────────────────┤
│                 数据存储层                        │
│         PostgreSQL / Redis / InfluxDB            │
└─────────────────────────────────────────────────┘
```

## 项目结构

```
pv-output-warning-system/
├── backend/                # 后端服务
│   ├── app/
│   │   ├── api/            # API路由
│   │   ├── core/           # 核心配置
│   │   ├── models/         # 数据模型
│   │   ├── services/       # 业务服务
│   │   │   ├── weather.py      # 气象数据采集
│   │   │   ├── forecast.py     # 出力预测
│   │   │   ├── warning.py      # 预警引擎
│   │   │   └── notification.py # 通知推送
│   │   └── utils/          # 工具函数
│   ├── tests/              # 测试
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/               # 前端应用
│   ├── src/
│   ├── package.json
│   └── Dockerfile
├── data/                   # 数据与模型
│   ├── models/             # 训练好的预测模型
│   └── samples/            # 示例数据
├── docs/                   # 文档
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## 预警等级

| 等级 | 颜色 | 条件 | 响应建议 |
|------|------|------|----------|
| IV级 | 🔵 蓝色 | 预计1小时内出力下降 20%-40% | 关注气象变化，做好调度准备 |
| III级 | 🟡 黄色 | 预计1小时内出力下降 40%-60% | 启动备用电源预热 |
| II级 | 🟠 橙色 | 预计30分钟内出力下降 60%-80% | 启动备用电源，调整负荷分配 |
| I级 | 🔴 红色 | 预计30分钟内出力下降 >80% | 紧急调度，切换备用电源 |

## 快速开始

```bash
# 克隆项目
git clone https://github.com/Linekerzhu/pv-output-warning-system.git
cd pv-output-warning-system

# 后端启动
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# 前端启动
cd frontend
npm install
npm run dev
```

## 环境变量

参见 `.env.example` 文件配置气象API密钥等信息。

## 许可证

MIT License
