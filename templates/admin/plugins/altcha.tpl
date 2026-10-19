<div class="acp-page-container">
	<!-- IMPORT admin/partials/settings/header.tpl -->

	<div class="row m-0">
		<div id="spy-container" class="col-12 col-md-8 px-0 mb-4" tabindex="0">
			<form role="form" class="altcha-settings">
				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">Proof of work</h5>
					<p class="form-text">
						The browser derives up to a random counter between min and max, so expected work is roughly
						cost x counter. Blank fields use the defaults shown. Raise these if bots get through, lower them if phones feel slow.
					</p>

					<div class="mb-3">
						<label class="form-label" for="cost">PBKDF2 cost (iterations per attempt)</label>
						<input type="number" id="cost" name="cost" class="form-control" placeholder="2000">
					</div>
					<div class="mb-3">
						<label class="form-label" for="counterMin">Counter min</label>
						<input type="number" id="counterMin" name="counterMin" class="form-control" placeholder="1000">
					</div>
					<div class="mb-3">
						<label class="form-label" for="counterMax">Counter max</label>
						<input type="number" id="counterMax" name="counterMax" class="form-control" placeholder="3000">
					</div>
					<div class="mb-3">
						<label class="form-label" for="expiry">Challenge lifetime (seconds)</label>
						<input type="number" id="expiry" name="expiry" class="form-control" placeholder="600">
					</div>
				</div>

				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">Widget</h5>
					<div class="mb-3">
						<label class="form-label" for="auto">Start verification</label>
						<select id="auto" name="auto" class="form-select">
							<option value="onfocus">When the form is focused (recommended)</option>
							<option value="onload">On page load</option>
							<option value="off">Only when clicking Register</option>
						</select>
					</div>
					<div class="mb-3">
						<label class="form-label" for="scriptUrl">Widget script URL (optional)</label>
						<input type="text" id="scriptUrl" name="scriptUrl" class="form-control" placeholder="Blank = self-hosted from the altcha npm package">
					</div>
				</div>

				<div class="mb-4">
					<h5 class="fw-bold tracking-tight settings-header">Abuse limits</h5>
					<div class="mb-3">
						<label class="form-label" for="rateLimit">Challenge requests per IP per 10 minutes (per process)</label>
						<input type="number" id="rateLimit" name="rateLimit" class="form-control" placeholder="30">
					</div>
				</div>
			</form>
		</div>
	</div>
</div>
