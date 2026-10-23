// 运行指标导出服务

import fs from 'node:fs'
import type { MetricSample } from './metrics'

/**
 * 将指标数据导出为 CSV 文件
 * CSV 列: timestamp, messageCount, avgLatency, p95Latency, errorRate, errorTypes
 */
export function exportToCSV(dataPoints: MetricSample[], outputPath: string): void {
  const header = 'timestamp,messageCount,avgLatency,p95Latency,errorRate,errorTypes'

  const rows = dataPoints.map((m) => {
    const errorTypesStr = JSON.stringify(m.errorTypes)
    return [
      escapeCSV(m.timestamp),
      m.msgCount,
      m.avgLatency,
      m.p95Latency,
      m.errorRate,
      escapeCSV(errorTypesStr)
    ].join(',')
  })

  const content = [header, ...rows].join('\n')
  fs.writeFileSync(outputPath, content, 'utf-8')
}

/**
 * 将指标数据导出为 JSON 文件
 */
export function exportToJSON(dataPoints: MetricSample[], outputPath: string): void {
  const data = dataPoints.map((m) => ({
    timestamp: m.timestamp,
    messageCount: m.msgCount,
    avgLatency: m.avgLatency,
    p95Latency: m.p95Latency,
    errorRate: m.errorRate,
    errorTypes: m.errorTypes
  }))

  const content = JSON.stringify({
    exportTime: new Date().toISOString(),
    source: 'QQBat Metrics',
    metrics: data
  }, null, 2)

  fs.writeFileSync(outputPath, content, 'utf-8')
}

/** CSV 字段转义 */
function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
