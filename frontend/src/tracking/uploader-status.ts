import type { UploaderStatus } from '@/tracking/uploader'

export function describeUploaderStatus(status: UploaderStatus): string {
  switch (status) {
    case 'idle':
      return 'synced'
    case 'syncing':
      return 'syncing…'
    case 'waiting-retry':
      return 'retrying…'
    case 'paused-sign-in-required':
      return 'paused — sign in again to resume'
    case 'paused-account-mismatch':
      return 'paused — sign in as the recording account to resume'
    case 'paused-wifi-required':
      return 'paused — waiting for Wi-Fi'
    case 'terminated':
      return 'stopped'
  }
}
