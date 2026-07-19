import { InMemoryDeliveryLedger } from './in-memory-delivery-ledger';

describe('InMemoryDeliveryLedger', () => {
  it('처음 조회하는 키는 전송되지 않은 것으로 판단한다', () => {
    const ledger = new InMemoryDeliveryLedger();
    expect(ledger.wasDelivered('job-1')).toBe(false);
  });

  it('markDelivered 이후에는 동일 키가 전송된 것으로 판단된다', () => {
    const ledger = new InMemoryDeliveryLedger();
    ledger.markDelivered('job-1');
    expect(ledger.wasDelivered('job-1')).toBe(true);
  });

  it('서로 다른 키는 독립적으로 관리된다', () => {
    const ledger = new InMemoryDeliveryLedger();
    ledger.markDelivered('job-1');
    expect(ledger.wasDelivered('job-2')).toBe(false);
  });
});
