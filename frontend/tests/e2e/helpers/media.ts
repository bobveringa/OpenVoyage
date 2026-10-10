import { expect, type APIRequestContext } from '@playwright/test'

export async function waitForMediaReady(
  request: APIRequestContext,
  apiBaseUrl: string,
  mediaId: string,
  headers: Record<string, string>,
) {
  await expect
    .poll(async () => {
      const response = await request.get(
        `${apiBaseUrl}/api/v1/media/${mediaId}`,
        { headers },
      )
      await expect(response).toBeOK()
      const media = (await response.json()) as { status: string }
      if (media.status === 'FAILED') {
        throw new Error(`Processing failed for E2E media ${mediaId}`)
      }
      return media.status
    }, {
      message: `Wait for E2E media ${mediaId} to finish processing`,
      timeout: 15_000,
    })
    .toBe('READY')
}
