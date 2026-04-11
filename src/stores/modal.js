/**
 * 模态框状态 store
 * 统一管理输入框、确认框等模态交互，支持 Promise 风格调用
 * 替代原来散落在各处的 showInputModal / _pendingConfirmAction
 */
import { defineStore } from 'pinia'

export const useModalStore = defineStore('modal', {
  state: () => ({
    /** 输入框模态 */
    input: {
      visible: false,
      title: '输入',
      placeholder: '请输入...',
      value: '',
      _resolve: null,
    },
    /** 确认框模态 */
    confirm: {
      visible: false,
      message: '',
      danger: true,
      _resolve: null,
    },
  }),

  actions: {
    /**
     * 显示输入框，返回 Promise<string|null>
     * null 表示用户取消
     */
    showInput(title, placeholder = '请输入...', defaultValue = '') {
      return new Promise((resolve) => {
        this.input.title = title
        this.input.placeholder = placeholder
        this.input.value = defaultValue
        this.input._resolve = resolve
        this.input.visible = true
      })
    },

    /** 用户点击确定 */
    confirmInput() {
      const val = this.input.value.trim()
      this.input.visible = false
      this.input._resolve?.(val || null)
      this.input._resolve = null
      this.input.value = ''
    },

    /** 用户取消输入 */
    cancelInput() {
      this.input.visible = false
      this.input._resolve?.(null)
      this.input._resolve = null
      this.input.value = ''
    },

    /**
     * 显示确认框，返回 Promise<boolean>
     */
    showConfirm(message, danger = true) {
      return new Promise((resolve) => {
        this.confirm.message = message
        this.confirm.danger = danger
        this.confirm._resolve = resolve
        this.confirm.visible = true
      })
    },

    /** 用户点击确定 */
    confirmAction() {
      this.confirm.visible = false
      this.confirm._resolve?.(true)
      this.confirm._resolve = null
    },

    /** 用户点击取消 */
    cancelAction() {
      this.confirm.visible = false
      this.confirm._resolve?.(false)
      this.confirm._resolve = null
    },
  },
})
