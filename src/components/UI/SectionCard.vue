<script setup lang="ts">
/**
 * 带标题的卡片容器组件
 * 统一的分析模块卡片样式
 */
defineProps<{
  /** 卡片标题 */
  title: string
  /** 可选的描述文字 */
  description?: string
  /** 是否显示边框分隔线（默认 true） */
  showDivider?: boolean
}>()

// 设置默认值
const showDivider = defineModel('showDivider', { default: true })
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
    <!-- 标题区域 -->
    <div class="px-5 py-3" :class="{ 'border-b border-gray-200 dark:border-gray-800': showDivider && $slots.default }">
      <div class="flex items-center justify-between">
        <div>
          <p class="font-semibold text-gray-900 dark:text-white whitespace-nowrap">{{ title }}</p>
          <p v-if="description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{ description }}
          </p>
        </div>
        <!-- 标题右侧插槽 -->
        <slot name="headerRight" />
      </div>
    </div>

    <!-- 内容区域 -->
    <slot />
  </div>
</template>
