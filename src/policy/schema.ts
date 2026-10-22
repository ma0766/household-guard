// The Cedar schema, as a string so the bundled Lambda needs no extra file (schema.cedarschema is the readable copy; a test keeps them equal).
export const SCHEMA_TEXT = `entity Role;
entity Person in [Role];
entity Service;

action light, thermostat, music, weather, timer, unlock, garage, purchase, use_app, build_site, order_history, order_status, cart, order_gift, mark_gift appliesTo {
  principal: [Person],
  resource: [Service],
  context: {
    service_known: Bool,
    amount_cents: Long,
    week_spent_cents: Long,
    value: Long,
    session: String,
    local_hour: Long,
    kind: String,
    scam: Bool,
  },
};
`;
