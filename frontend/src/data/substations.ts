/**
 * 金山区 110kV 变电站
 *
 * 15 个变电站，坐标为 Mock（基于地名大致定位）
 * 后续接入真实坐标和电网拓扑
 */

export interface Substation {
  id: string
  name: string
  lat: number
  lon: number
  voltage_kv: number
}

export const SUBSTATIONS: Substation[] = [
  { id: "SS-jinyu",     name: "金鱼变电站",   lat: 30.735, lon: 121.280, voltage_kv: 110 },
  { id: "SS-zhangyan",  name: "张堰变电站",   lat: 30.800, lon: 121.280, voltage_kv: 110 },
  { id: "SS-nanyangwan", name: "南阳湾变电站", lat: 30.720, lon: 121.340, voltage_kv: 110 },
  { id: "SS-puhua",     name: "普华变电站",   lat: 30.725, lon: 121.310, voltage_kv: 110 },
  { id: "SS-dongxian",  name: "东贤变电站",   lat: 30.885, lon: 121.175, voltage_kv: 110 },
  { id: "SS-huifeng",   name: "汇丰变电站",   lat: 30.760, lon: 121.260, voltage_kv: 110 },
  { id: "SS-zhongyi",   name: "众益变电站",   lat: 30.840, lon: 121.230, voltage_kv: 110 },
  { id: "SS-haifeng",   name: "海丰变电站",   lat: 30.770, lon: 121.310, voltage_kv: 110 },
  { id: "SS-jinzhan",   name: "金展变电站",   lat: 30.745, lon: 121.295, voltage_kv: 110 },
  { id: "SS-tongkai",   name: "同凯变电站",   lat: 30.870, lon: 121.300, voltage_kv: 110 },
  { id: "SS-jinghe",    name: "泾荷变电站",   lat: 30.880, lon: 121.050, voltage_kv: 110 },
  { id: "SS-langping",  name: "廊平变电站",   lat: 30.810, lon: 121.185, voltage_kv: 110 },
  { id: "SS-tinglin",   name: "亭林变电站",   lat: 30.895, lon: 121.330, voltage_kv: 110 },
  { id: "SS-caojing",   name: "漕泾变电站",   lat: 30.800, lon: 121.410, voltage_kv: 110 },
  { id: "SS-shanyang",  name: "山阳变电站",   lat: 30.765, lon: 121.355, voltage_kv: 110 },
]
