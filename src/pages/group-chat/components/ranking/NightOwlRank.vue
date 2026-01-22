<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { NightOwlAnalysis } from '@/types/analysis'
import { RankListPro } from '@/components/charts'
import { SectionCard } from '@/components/UI'

interface TimeFilter {
  startTs?: number
  endTs?: number
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
}>()

const analysis = ref<NightOwlAnalysis | null>(null)
const isLoading = ref(false)

// 称号颜色映射
const titleColors: Record<string, string> = {
  养生达人: 'text-green-600 dark:text-green-400',
  偶尔失眠: 'text-blue-600 dark:text-blue-400',
  经常失眠: 'text-yellow-600 dark:text-yellow-400',
  夜猫子: 'text-orange-600 dark:text-orange-400',
  秃头预备役: 'text-pink-600 dark:text-pink-400',
  修仙练习生: 'text-purple-600 dark:text-purple-400',
  守夜冠军: 'text-red-600 dark:text-red-400',
}

async function loadData() {
  if (!props.sessionId) return
  isLoading.value = true
  try {
    analysis.value = await window.chatApi.getNightOwlAnalysis(props.sessionId, props.timeFilter)
  } catch (error) {
    console.error('加载修仙分析失败:', error)
  } finally {
    isLoading.value = false
  }
}

// 最晚下班排行
const lastSpeakerMembers = computed(() => {
  if (!analysis.value) return []
  return analysis.value.lastSpeakerRank.map((item) => ({
    id: String(item.memberId),
    name: item.name,
    value: item.count,
    percentage: item.percentage,
  }))
})

// 最早上班排行
const firstSpeakerMembers = computed(() => {
  if (!analysis.value) return []
  return analysis.value.firstSpeakerRank.map((item) => ({
    id: String(item.memberId),
    name: item.name,
    value: item.count,
    percentage: item.percentage,
  }))
})

watch(
  () => [props.sessionId, props.timeFilter],
  () => loadData(),
  { immediate: true, deep: true }
)
</script>

<template>
  <SectionCard title="🦉 修仙榜" :show-divider="false">
    <template #headerRight>
      <span class="text-xs text-gray-400">深夜时段 23:00 - 05:00</span>
    </template>

    <div class="p-5">
      <div v-if="isLoading" class="flex h-32 items-center justify-center">
        <UIcon name="i-heroicons-arrow-path" class="h-6 w-6 animate-spin text-pink-500" />
      </div>

      <template v-else-if="analysis">
        <!-- 修仙王者 TOP 3 -->
        <div v-if="analysis.champions.length > 0" class="mb-6">
          <h4 class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">🏆 修仙王者</h4>
          <div class="grid gap-3 sm:grid-cols-3">
            <div
              v-for="(champion, index) in analysis.champions.slice(0, 3)"
              :key="champion.memberId"
              class="relative overflow-hidden rounded-lg p-4"
              :class="[
                index === 0
                  ? 'bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-900/20 dark:to-orange-900/20'
                  : index === 1
                    ? 'bg-gradient-to-br from-gray-50 to-slate-100 dark:from-gray-800/50 dark:to-slate-800/50'
                    : 'bg-gradient-to-br from-orange-50 to-amber-100 dark:from-orange-900/10 dark:to-amber-900/10',
              ]"
            >
              <div class="absolute right-2 top-2 text-3xl opacity-20">
                {{ index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉' }}
              </div>
              <div class="text-lg font-bold text-gray-900 dark:text-white">{{ champion.name }}</div>
              <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">综合得分 {{ champion.score }}</div>
              <div class="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300">
                <div>🌙 深夜发言 {{ champion.nightMessages }} 条</div>
                <div>🔚 最晚下班 {{ champion.lastSpeakerCount }} 次</div>
                <div>🔥 连续修仙 {{ champion.consecutiveDays }} 天</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 修仙排行榜 -->
        <div class="mb-6">
          <h4 class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">🌙 深夜发言排行</h4>
          <div v-if="analysis.nightOwlRank.length > 0" class="space-y-2">
            <div
              v-for="(item, index) in analysis.nightOwlRank.slice(0, 10)"
              :key="item.memberId"
              class="flex items-center gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50"
            >
              <span class="w-6 text-center text-sm font-bold text-gray-400">{{ index + 1 }}</span>
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-gray-900 dark:text-white">{{ item.name }}</span>
                  <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="titleColors[item.title]">
                    {{ item.title }}
                  </span>
                </div>
                <div class="mt-1 flex gap-3 text-xs text-gray-500 dark:text-gray-400">
                  <span>共 {{ item.totalNightMessages }} 条</span>
                  <span>23点:{{ item.hourlyBreakdown.h23 }}</span>
                  <span>0点:{{ item.hourlyBreakdown.h0 }}</span>
                  <span>1点:{{ item.hourlyBreakdown.h1 }}</span>
                  <span>2点:{{ item.hourlyBreakdown.h2 }}</span>
                  <span>3-4点:{{ item.hourlyBreakdown.h3to4 }}</span>
                </div>
              </div>
              <span class="text-sm font-semibold text-pink-600 dark:text-pink-400">{{ item.percentage }}%</span>
            </div>
          </div>
          <div v-else class="py-8 text-center text-sm text-gray-400">暂无深夜发言数据</div>
        </div>

        <!-- 最晚下班 & 最早上班 -->
        <div class="grid gap-6">
          <!-- 最晚下班排名 -->
          <div>
            <RankListPro
              v-if="lastSpeakerMembers.length > 0"
              :members="lastSpeakerMembers"
              title="🔚 最晚下班排名"
              :description="`每天最后一个发言的人（共 ${analysis.totalDays} 天）`"
              unit="次"
            />
            <div v-else class="py-4 text-center text-sm text-gray-400">暂无数据</div>
          </div>

          <!-- 最早上班排名 -->
          <div>
            <RankListPro
              v-if="firstSpeakerMembers.length > 0"
              :members="firstSpeakerMembers"
              title="🌅 最早上班排名"
              :description="`每天第一个发言的人（共 ${analysis.totalDays} 天）`"
              unit="次"
            />
            <div v-else class="py-4 text-center text-sm text-gray-400">暂无数据</div>
          </div>
        </div>

        <!-- 连续修仙记录 -->
        <div v-if="analysis.consecutiveRecords.length > 0" class="mt-6">
          <h4 class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">🔥 连续修仙记录</h4>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="record in analysis.consecutiveRecords.slice(0, 6)"
              :key="record.memberId"
              class="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50"
            >
              <span class="font-medium text-gray-900 dark:text-white whitespace-nowrap">{{ record.name }}</span>
              <div class="text-right">
                <div class="text-lg font-bold text-pink-600 dark:text-pink-400">{{ record.maxConsecutiveDays }} 天</div>
                <div v-if="record.currentStreak > 0" class="text-xs text-green-600 dark:text-green-400">
                  当前连续 {{ record.currentStreak }} 天
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </SectionCard>
</template>
