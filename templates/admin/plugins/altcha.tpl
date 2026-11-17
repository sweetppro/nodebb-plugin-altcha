<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 col-md-8 px-0 mb-4" tabindex="0">
			<ul class="nav nav-tabs mb-4" role="tablist">
				{{{ each forms }}}
				<li class="nav-item" role="presentation">
					<button class="nav-link {{{ if @first }}}active{{{ end }}}" data-bs-toggle="tab" data-bs-target="#altcha-tab-{./id}" type="button" role="tab">{./title}</button>
				</li>
				{{{ end }}}
				<li class="nav-item" role="presentation">
					<button class="nav-link" data-bs-toggle="tab" data-bs-target="#altcha-tab-general" type="button" role="tab">General</button>
				</li>
			</ul>

			<form role="form" class="altcha-settings">
				<div class="tab-content">
					{{{ each forms }}}
					<div class="tab-pane fade {{{ if @first }}}show active{{{ end }}}" id="altcha-tab-{./id}" role="tabpanel">
						{{{ if ./unavailable }}}
						<div class="alert alert-danger">
							The user.reset.send socket method was not found on this NodeBB version, so password reset
							protection is not active even if enabled. Check the server log.
						</div>
						{{{ end }}}

						<div class="form-check form-switch mb-2">
							<input class="form-check-input" type="checkbox" id="{./id}Enabled" name="{./id}Enabled" data-effective="{./enabledNum}">
							<label class="form-check-label" for="{./id}Enabled">Require ALTCHA on {./title}</label>
						</div>
						<p class="form-text mb-4">{./note}</p>

						<h5 class="fw-bold tracking-tight settings-header">Proof of work</h5>
						<p class="form-text">
							The browser derives up to a random counter between min and max, so expected work is roughly
							cost x counter. Blank fields use the defaults shown.
						</p>
						<div class="mb-3">
							<label class="form-label" for="{./id}Cost">PBKDF2 cost (iterations per attempt)</label>
							<input type="number" id="{./id}Cost" name="{./id}Cost" class="form-control" placeholder="2000">
						</div>
						<div class="mb-3">
							<label class="form-label" for="{./id}CounterMin">Counter min</label>
							<input type="number" id="{./id}CounterMin" name="{./id}CounterMin" class="form-control" placeholder="1000">
						</div>
						<div class="mb-3">
							<label class="form-label" for="{./id}CounterMax">Counter max</label>
							<input type="number" id="{./id}CounterMax" name="{./id}CounterMax" class="form-control" placeholder="3000">
						</div>
						<div class="mb-3">
							<label class="form-label" for="{./id}Expiry">Challenge lifetime (seconds)</label>
							<input type="number" id="{./id}Expiry" name="{./id}Expiry" class="form-control" placeholder="600">
						</div>

						<h5 class="fw-bold tracking-tight settings-header mt-4">Widget</h5>
						<p class="form-text mb-3">
							Verification runs only when the visitor clicks the ALTCHA checkbox.
							Submitting the form does not start it, and neither does loading or refreshing the page.
						</p>

						<h5 class="fw-bold tracking-tight settings-header mt-4">Abuse limit</h5>
						<div class="mb-3">
							<label class="form-label" for="{./id}RateLimit">Challenge requests per IP per 10 minutes (shared across all workers)</label>
							<input type="number" id="{./id}RateLimit" name="{./id}RateLimit" class="form-control" placeholder="30">
						</div>
					</div>
					{{{ end }}}

					<div class="tab-pane fade" id="altcha-tab-general" role="tabpanel">
						<h5 class="fw-bold tracking-tight settings-header">Widget script</h5>
						<div class="mb-3">
							<label class="form-label" for="scriptUrl">Widget script URL (optional)</label>
							<input type="text" id="scriptUrl" name="scriptUrl" class="form-control" placeholder="Blank = self-hosted from the altcha npm package">
						</div>
					</div>
				</div>
			</form>
		</div>
	</div>
</div>
