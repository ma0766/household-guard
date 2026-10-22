@id("service_unknown")
forbid(principal, action, resource) when { !context.service_known && action != Action::"build_site" && action != Action::"connect_device" && action != Action::"start_project" && action != Action::"publish_project" };

@id("light")
permit(principal, action == Action::"light", resource);

@id("thermostat")
permit(principal, action == Action::"thermostat", resource);

@id("music")
permit(principal, action == Action::"music", resource);

@id("weather")
permit(principal, action == Action::"weather", resource);

@id("timer")
permit(principal, action == Action::"timer", resource);

@id("thermostat_range")
forbid(principal, action == Action::"thermostat", resource) when { context.value < 60 || context.value > 78 };

@id("use_app")
permit(principal, action == Action::"use_app", resource);

@id("use_app_not_guests")
forbid(principal in Role::"guest", action == Action::"use_app", resource);

@id("vacuum")
permit(principal, action == Action::"vacuum", resource);

@id("connect_device")
permit(principal in Role::"adult", action == Action::"connect_device", resource);

@id("connect_device_needs_phone")
forbid(principal, action == Action::"connect_device", resource) when { context.session != "phone" };

@id("start_project")
permit(principal, action == Action::"start_project", resource) when { principal in Role::"adult" || principal in Role::"teen" || principal in Role::"child" };

@id("publish_project")
permit(principal in Role::"adult", action == Action::"publish_project", resource);

@id("publish_project_needs_phone")
forbid(principal, action == Action::"publish_project", resource) when { context.session != "phone" };

@id("build_site")
permit(principal in Role::"adult", action == Action::"build_site", resource);

@id("build_site_needs_phone")
forbid(principal, action == Action::"build_site", resource) when { context.session != "phone" };

@id("adults_only_unlock")
forbid(principal, action == Action::"unlock", resource) unless { principal in Role::"adult" || principal in Role::"visitor" };

@id("adult_unlock")
permit(principal in Role::"adult", action == Action::"unlock", resource);

@id("unlock_needs_phone")
forbid(principal, action == Action::"unlock", resource) when { context.session != "phone" } unless { principal in Role::"visitor" };

@id("garage_open")
permit(principal, action == Action::"garage", resource) when { principal in Role::"adult" || principal in Role::"teen" };

@id("garage_not_for_kids")
forbid(principal, action == Action::"garage", resource) when { principal in Role::"child" || principal in Role::"guest" };

@id("visitors_only_the_door")
forbid(principal, action, resource) when { principal in Role::"visitor" } unless { action == Action::"unlock" };

@id("purchase")
permit(principal, action == Action::"purchase", resource);

@id("scam_guard")
forbid(principal, action == Action::"purchase", resource) when { context.scam };

@id("purchase_needs_a_limit")
forbid(principal, action == Action::"purchase", resource) unless { [Person::"mom", Person::"maya"].contains(principal) };

@id("cap_mom")
forbid(principal == Person::"mom", action == Action::"purchase", resource) when { context.amount_cents > 20000 || context.week_spent_cents + context.amount_cents > 50000 };

@id("cap_maya")
forbid(principal == Person::"maya", action == Action::"purchase", resource) when { context.amount_cents > 2000 || context.week_spent_cents + context.amount_cents > 2000 };

@id("gift_mark")
permit(principal in Role::"adult", action == Action::"mark_gift", resource);

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
