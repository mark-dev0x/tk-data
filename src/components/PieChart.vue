<template>
  <div class="relative">
    <canvas :id="chartId" :width="width" :height="height"></canvas>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  Chart as ChartJS,
  ArcElement,
  PieController,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js'

ChartJS.register(ArcElement, PieController, Tooltip, Legend, Filler)

interface Props {
  data: {
    labels: string[]
    datasets: {
      data: number[]
      backgroundColor: string[]
      borderColor: string[]
      borderWidth?: number
    }[]
  }
  options?: ChartOptions<'pie'>
  width?: number
  height?: number
  chartId?: string
}

const props = withDefaults(defineProps<Props>(), {
  width: 400,
  height: 400,
  chartId: () => `pie-chart-${Math.random().toString(36).substr(2, 9)}`,
})

let chart: ChartJS<'pie'> | null = null

const defaultOptions: ChartOptions<'pie'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        padding: 20,
        usePointStyle: true,
        font: {
          size: 12,
        },
      },
    },
    tooltip: {
      callbacks: {
        label: function (context) {
          const label = context.label || ''
          const value = context.parsed
          const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0)
          const percentage = ((value / total) * 100).toFixed(1)
          return `${label}: ${value} (${percentage}%)`
        },
      },
    },
  },
}

const createChart = () => {
  // console.log('Creating pie chart with ID:', props.chartId)
  // console.log('Pie chart data:', props.data)

  const canvas = document.getElementById(props.chartId) as HTMLCanvasElement
  if (!canvas) {
    console.error('Canvas element not found:', props.chartId)
    return
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    console.error('Canvas context not available')
    return
  }

  try {
    chart = new ChartJS(ctx, {
      type: 'pie',
      data: props.data,
      options: { ...defaultOptions, ...props.options },
    })
    // console.log('Pie chart created successfully:', chart)
  } catch (error) {
    console.error('Error creating pie chart:', error)
  }
}

const updateChart = () => {
  if (chart) {
    chart.data = props.data
    chart.update()
  }
}

onMounted(async () => {
  await nextTick()
  setTimeout(() => {
    createChart()
  }, 100)
})

onUnmounted(() => {
  if (chart) {
    chart.destroy()
  }
})

watch(() => props.data, updateChart, { deep: true })
</script>
