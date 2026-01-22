<script setup lang="ts">
import { computed } from 'vue'
import { Doughnut } from 'vue-chartjs'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'

ChartJS.register(ArcElement, Tooltip, Legend)

export interface DoughnutChartData {
  labels: string[]
  values: number[]
  colors?: string[]
}

interface Props {
  data: DoughnutChartData
  cutout?: number | string
  height?: number
  showLegend?: boolean
  legendPosition?: 'top' | 'bottom' | 'left' | 'right'
}

const props = withDefaults(defineProps<Props>(), {
  cutout: '60%',
  height: 256,
  showLegend: true,
  legendPosition: 'bottom',
})

// 默认颜色方案
const defaultColors = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#94a3b8', // gray
]

const chartData = computed(() => {
  return {
    labels: props.data.labels,
    datasets: [
      {
        data: props.data.values,
        backgroundColor: props.data.colors || defaultColors.slice(0, props.data.values.length),
        borderWidth: 0,
        hoverOffset: 4,
      },
    ],
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: props.showLegend,
      position: props.legendPosition,
      labels: {
        padding: 16,
        usePointStyle: true,
        pointStyle: 'circle',
      },
    },
    tooltip: {
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      padding: 12,
      cornerRadius: 8,
    },
  },
  cutout: props.cutout,
}))
</script>

<template>
  <div :style="{ height: `${height}px` }">
    <Doughnut :data="chartData" :options="chartOptions" />
  </div>
</template>
