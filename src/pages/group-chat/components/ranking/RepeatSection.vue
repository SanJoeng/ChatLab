<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RepeatAnalysis } from '@/types/analysis'
import { RankListPro, BarChart, ListPro } from '@/components/charts'
import type { RankItem, BarChartData } from '@/components/charts'
import { SectionCard, EmptyState, LoadingState } from '@/components/UI'
import { getRankBadgeClass } from '@/utils'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const analysis = ref<RepeatAnalysis | null>(null)
const isLoading = ref(false)
const rankMode = ref<'count' | 'rate'>('count')

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await window.chatApi.getRepeatAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载复读分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

const originatorRankData = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  const data = rankMode.value === 'count' ? analysis.value.originators : analysis.value.originatorRates
  return data.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: (m as any).count,
    percentage: rankMode.value === 'count' ? (m as any).percentage : (m as any).rate,
  }))
})

const initiatorRankData = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  const data = rankMode.value === 'count' ? analysis.value.initiators : analysis.value.initiatorRates
  return data.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: (m as any).count,
    percentage: rankMode.value === 'count' ? (m as any).percentage : (m as any).rate,
  }))
})

const breakerRankData = computed<RankItem[]>(() => {
  if (!analysis.value) return []
  const data = rankMode.value === 'count' ? analysis.value.breakers : analysis.value.breakerRates
  return data.map((m) => ({
    id: m.memberId.toString(),
    name: m.name,
    value: (m as any).count,
    percentage: rankMode.value === 'count' ? (m as any).percentage : (m as any).rate,
  }))
})

const chainLengthChartData = computed<BarChartData>(() => {
  if (!analysis.value) return { labels: [], values: [] }
  const distribution = analysis.value.chainLengthDistribution
  return {
    labels: distribution.map((d) => `${d.length}人`),
    values: distribution.map((d) => d.count),
  }
})

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <SectionCard
    title="复读榜"
    :description="
      isLoading
        ? '加载中...'
        : analysis
          ? `共检测到 ${analysis.totalRepeatChains} 次复读，平均复读链长度 ${analysis.avgChainLength} 人`
          : '暂无复读数据'
    "
  >
    <template #headerRight>
      <UTabs
        v-if="analysis && analysis.totalRepeatChains > 0"
        v-model="rankMode"
        :items="[
          { label: '按次数', value: 'count' },
          { label: '按复读率', value: 'rate' },
        ]"
        size="xs"
      />
    </template>

    <LoadingState v-if="isLoading" text="正在分析复读数据..." />

    <div v-else-if="analysis && analysis.totalRepeatChains > 0" class="space-y-6 p-5">
      <!-- 复读链长度分布 -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div class="rounded-lg border border-gray-100 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-800/50">
          <div class="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
            <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300">📊 复读链长度分布</h4>
            <p class="mt-0.5 text-xs text-gray-500 dark:text-gray-400">每次复读有多少人参与</p>
          </div>
          <div class="p-4">
            <BarChart v-if="chainLengthChartData.labels.length > 0" :data="chainLengthChartData" :height="200" />
            <EmptyState v-else padding="md" />
          </div>
        </div>
      </div>

      <!-- 复读排行榜 Grid -->
      <div class="grid grid-cols-1 gap-6">
        <RankListPro
          v-if="originatorRankData.length > 0"
          :members="originatorRankData"
          title="🎯 谁的聊天最容易产生复读"
          :description="rankMode === 'rate' ? '被复读次数 / 总发言数' : '发出的消息被别人复读的次数'"
          unit="次"
        />

        <RankListPro
          v-if="initiatorRankData.length > 0"
          :members="initiatorRankData"
          title="🔥 谁最喜欢挑起复读"
          :description="rankMode === 'rate' ? '挑起复读次数 / 总发言数' : '第二个发送相同消息、带起节奏的人'"
          unit="次"
        />

        <RankListPro
          v-if="breakerRankData.length > 0"
          :members="breakerRankData"
          title="✂️ 谁喜欢打断复读"
          :description="rankMode === 'rate' ? '打断复读次数 / 总发言数' : '终结复读链的人'"
          unit="次"
        />

        <!-- 最快复读选手 -->
        <ListPro
          v-if="analysis.fastestRepeaters && analysis.fastestRepeaters.length > 0"
          :items="analysis.fastestRepeaters"
          title="⚡️ 最快复读选手"
          description="平均复读反应时间（至少参与5次复读）"
          countTemplate="共 {count} 位选手"
        >
          <template #item="{ item: member, index }">
            <div class="flex items-center gap-3">
              <!-- 排名 -->
              <div
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                :class="getRankBadgeClass(index)"
              >
                {{ index + 1 }}
              </div>

              <!-- 名字 -->
              <div class="w-32 shrink-0">
                <p class="truncate font-medium text-gray-900 dark:text-white">
                  {{ member.name }}
                </p>
              </div>

              <!-- 反应时间条（第一名100%，越慢越短） -->
              <div class="flex flex-1 items-center">
                <div class="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    class="h-full rounded-full bg-linear-to-r from-yellow-400 to-orange-500"
                    :style="{
                      width: `${Math.round((analysis!.fastestRepeaters[0].avgTimeDiff / member.avgTimeDiff) * 100)}%`,
                    }"
                  />
                </div>
              </div>

              <!-- 统计数据 -->
              <div class="flex shrink-0 items-baseline gap-2">
                <span class="text-lg font-bold text-gray-900 dark:text-white">
                  {{ (member.avgTimeDiff / 1000).toFixed(2) }}s
                </span>
                <span class="text-xs text-gray-500">· {{ member.count }} 次</span>
              </div>
            </div>
          </template>
        </ListPro>
      </div>
    </div>

    <EmptyState v-else text="该群组暂无复读记录" />
  </SectionCard>
</template>
