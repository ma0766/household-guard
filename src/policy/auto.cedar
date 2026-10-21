@id("light")
permit(principal, action == Action::"light", resource) when { context.service_known };

@id("thermostat")
permit(principal, action == Action::"thermostat", resource) when { context.service_known && context.value >= 60 && context.value <= 78 };

@id("use_app")
permit(principal, action == Action::"use_app", resource) when { context.service_known } unless { principal in Role::"guest" };

@id("build_site")
permit(principal in Role::"adult", action == Action::"build_site", resource) when { context.session == "phone" };

@id("adults_only_unlock")
forbid(principal, action == Action::"unlock", resource) unless { principal in Role::"adult" };

@id("adult_unlock")
permit(principal in Role::"adult", action == Action::"unlock", resource) when { context.service_known && context.session == "phone" };

@id("adults_only_garage")
forbid(principal, action == Action::"garage", resource) unless { principal in Role::"adult" };

@id("adult_garage")
permit(principal in Role::"adult", action == Action::"garage", resource) when { context.service_known && context.session == "phone" };

@id("cap_mom")
permit(principal == Person::"mom", action == Action::"purchase", resource) when { context.service_known && context.amount_cents <= 20000 && context.week_spent_cents + context.amount_cents <= 50000 };

@id("cap_maya")
permit(principal == Person::"maya", action == Action::"purchase", resource) when { context.service_known && context.amount_cents <= 2000 && context.week_spent_cents + context.amount_cents <= 2000 };

@id("floor_guests_no_buy")
forbid(principal in Role::"guest", action == Action::"purchase", resource);

@id("floor_children_no_unlock")
forbid(principal in Role::"child", action == Action::"unlock", resource);
