// @vitest-environment jsdom

import { waitFor, within } from '@testing-library/vue'
import { describe, expect, test } from 'vitest'
import { toast } from 'vue-sonner'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { Toaster } from '#/web/components/ui/sonner.tsx'

describe('Toaster', () => {
  test('renders the complete icon set while keeping default toast bodies neutral', async ({ onTestFinished }) => {
    const view = renderInJsdom(<Toaster />)
    const { container } = view
    const toastIds: Array<string | number> = []

    onTestFinished(async () => {
      for (const id of toastIds) toast.dismiss(id)
      await view.flushAnimationFrames()
    })

    toastIds.push(toast.success('Success'))
    toastIds.push(toast.info('Info'))
    toastIds.push(toast.warning('Warning'))
    toastIds.push(toast.error('Error'))
    toastIds.push(toast.loading('Loading'))

    await waitFor(() => {
      expect(toastByTitle(container, 'Success').dataset.richColors).toBe('false')
      expect(toastByTitle(container, 'Info').dataset.richColors).toBe('false')
      expect(toastByTitle(container, 'Warning').dataset.richColors).toBe('false')
      expect(toastByTitle(container, 'Error').dataset.richColors).toBe('false')
      expect(toastByTitle(container, 'Loading').dataset.richColors).toBe('false')
    })

    expectToastIconClasses(container, 'Success', 'lucide-circle-check', 'text-success')
    expectToastIconClasses(container, 'Info', 'lucide-info', 'text-brand-text')
    expectToastIconClasses(container, 'Warning', 'lucide-triangle-alert', 'text-warning')
    expectToastIconClasses(container, 'Error', 'lucide-circle-x', 'text-danger')
    expectToastIconClasses(container, 'Loading', 'lucide-loader-circle', 'text-muted-foreground', 'animate-spin')
  })

  test('keeps rich colors bound to project theme tokens', () => {
    const { container } = renderInJsdom(<Toaster richColors />)
    const richColorsToaster = toaster(container)
    expect(richColorsToaster.dataset.richColors).toBe('true')
    expect(richColorsToaster.style.getPropertyValue('--success-text')).toBe('var(--color-success)')
    expect(richColorsToaster.style.getPropertyValue('--info-text')).toBe('var(--color-brand-text)')
    expect(richColorsToaster.style.getPropertyValue('--warning-text')).toBe('var(--color-warning)')
    expect(richColorsToaster.style.getPropertyValue('--error-text')).toBe('var(--color-danger)')
  })
})

function toastByTitle(container: HTMLElement, title: string): HTMLElement {
  const toastElement = within(container).getByText(title).closest<HTMLElement>('li')
  if (!toastElement) throw new Error(`missing ${title} toast`)
  return toastElement
}

function toaster(container: HTMLElement): HTMLOListElement {
  const toasterElement = container.querySelector<HTMLOListElement>('[data-sonner-toaster]')
  if (!toasterElement) throw new Error('missing toaster')
  return toasterElement
}

function toastIcon(toastElement: HTMLElement): SVGElement {
  const icon = toastElement.querySelector<SVGElement>('svg')
  if (!icon) throw new Error('missing toast icon')
  return icon
}

function expectToastIconClasses(container: HTMLElement, title: string, ...classes: string[]): void {
  expect(Array.from(toastIcon(toastByTitle(container, title)).classList)).toEqual(expect.arrayContaining(classes))
}
