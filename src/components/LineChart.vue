<template>
  <div class="relative">
    <canvas :id="chartId" :width="width" :height="height"></canvas>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  LineController,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js'

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  LineController,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

interface Props {
  data: {
    labels: string[]
    datasets: {
      label: string
      data: number[]
      borderColor: string
      backgroundColor: string
      fill?: boolean
      tension?: number
    }[]
  }
  options?: ChartOptions<'line'>
  width?: number
  height?: number
  chartId?: string
}

const props = withDefaults(defineProps<Props>(), {
  width: 400,
  height: 300,
  chartId: () => `line-chart-${Math.random().toString(36).substr(2, 9)}`,
})

let chart: ChartJS<'line'> | null = null

const defaultOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top',
      labels: {
        usePointStyle: true,
        padding: 20,
      },
    },
    title: {
      display: false,
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      grid: {
        color: 'rgba(0, 0, 0, 0.1)',
      },
    },
    x: {
      grid: {
        color: 'rgba(0, 0, 0, 0.1)',
      },
    },
  },
  elements: {
    line: {
      tension: 0.4,
    },
    point: {
      radius: 4,
      hoverRadius: 6,
    },
  },
}

const createChart = () => {
  console.log('Creating line chart with ID:', props.chartId)
  console.log('Line chart data:', props.data)

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
      type: 'line',
      data: props.data,
      options: { ...defaultOptions, ...props.options },
    })
    console.log('Line chart created successfully:', chart)
  } catch (error) {
    console.error('Error creating line chart:', error)
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
