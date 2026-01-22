<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DragonKingAnalysis } from '@/types/analysis'
import { RankListPro } from '@/components/charts'
import type { RankItem } from '@/components/charts'
import { LoadingState } from '@/components/UI'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const analysis = ref<DragonKingAnalysis | null>(null)
const isLoading = ref(false)

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await window.chatApi.getDragonKingAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载龙王分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

const rankData = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  return analysis.value.rank.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: m.count,
    percentage: m.percentage,
  }))
})

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <LoadingState v-if="isLoading" text="正在统计龙王数据..." />
  <RankListPro
    v-else-if="rankData.length > 0"
    :members="rankData"
    title="🐉 龙王榜"
    :description="`每天发言最多的人+1（共 ${analysis?.totalDays ?? 0} 天）`"
    unit="天"
  />
</template>
