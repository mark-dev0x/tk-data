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
  BarElement,
  BarController,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, BarController, Title, Tooltip, Legend)

interface Props {
  data: {
    labels: string[]
    datasets: {
      label: string
      data: number[]
      backgroundColor: string | string[]
      borderColor?: string | string[]
      borderWidth?: number
    }[]
  }
  options?: ChartOptions<'bar'>
  width?: number
  height?: number
  chartId?: string
}

const props = withDefaults(defineProps<Props>(), {
  width: 400,
  height: 300,
  chartId: () => `bar-chart-${Math.random().toString(36).substr(2, 9)}`,
})

let chart: ChartJS<'bar'> | null = null

const defaultOptions: ChartOptions<'bar'> = {
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
        display: false,
      },
    },
  },
}

const createChart = () => {
  // console.log('Creating bar chart with ID:', props.chartId)
  // console.log('Chart data:', props.data)

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
      type: 'bar',
      data: props.data,
      options: { ...defaultOptions, ...props.options },
    })
    // console.log('Bar chart created successfully:', chart)
  } catch (error) {
    console.error('Error creating bar chart:', error)
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
