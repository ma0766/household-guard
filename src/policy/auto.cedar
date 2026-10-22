@id("service_unknown")
forbid(principal, action, resource) when { !context.service_known && action != Action::"build_site" };

@id("light")
permit(principal, action == Action::"light", resource);

@id("thermostat")
permit(principal, action == Action::"thermostat", resource);

@id("thermostat_range")
forbid(principal, action == Action::"thermostat", resource) when { context.value < 60 || context.value > 78 };

@id("use_app")
permit(principal, action == Action::"use_app", resource);

@id("use_app_not_guests")
forbid(principal in Role::"guest", action == Action::"use_app", resource);

@id("build_site")
permit(principal in Role::"adult", action == Action::"build_site", resource);

@id("build_site_needs_phone")
forbid(principal, action == Action::"build_site", resource) when { context.session != "phone" };

@id("adults_only_unlock")
forbid(principal, action == Action::"unlock", resource) unless { principal in Role::"adult" };

@id("adult_unlock")
permit(principal in Role::"adult", action == Action::"unlock", resource);

@id("unlock_needs_phone")
forbid(principal, action == Action::"unlock", resource) when { context.session != "phone" };

@id("adults_only_garage")
forbid(principal, action == Action::"garage", resource) unless { principal in Role::"adult" };

@id("adult_garage")
permit(principal in Role::"adult", action == Action::"garage", resource);

@id("garage_needs_phone")
forbid(principal, action == Action::"garage", resource) when { context.session != "phone" };

@id("purchase")
permit(principal, action == Action::"purchase", resource);

@id("purchase_needs_a_limit")
forbid(principal, action == Action::"purchase", resource) unless { [Person::"mom", Person::"maya"].contains(principal) };

@id("cap_mom")
forbid(principal == Person::"mom", action == Action::"purchase", resource) when { context.amount_cents > 20000 || context.week_spent_cents + context.amount_cents > 50000 };

@id("cap_maya")
forbid(principal == Person::"maya", action == Action::"purchase", resource) when { context.amount_cents > 2000 || context.week_spent_cents + context.amount_cents > 2000 };

@id("orders_adult")
permit(principal in Role::"adult", action in [Action::"order_history", Action::"order_status", Action::"cart"], resource);

@id("gifts_adults")
permit(principal in Role::"adult", action == Action::"order_gift", resource);

@id("gifts_private")
forbid(principal, action == Action::"order_gift", resource) unless { principal in Role::"adult" };

@id("floor_guests_no_buy")
forbid(principal in Role::"guest", action == Action::"purchase", resource);

@id("floor_children_no_unlock")
forbid(principal in Role::"child", action == Action::"unlock", resource);
