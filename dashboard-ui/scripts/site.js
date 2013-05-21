﻿$.ajaxSetup({
    crossDomain: true,

    error: function (event) {
        Dashboard.hideLoadingMsg();

        if (!Dashboard.suppressAjaxErrors) {
            setTimeout(function () {


                var msg = event.getResponseHeader("X-Application-Error-Code") || Dashboard.defaultErrorMessage;

                Dashboard.showError(msg);
            }, 500);
        }
    }
});

if ($.browser.msie) {

    // This is unfortuantely required due to IE's over-aggressive caching. 
    // https://github.com/MediaBrowser/MediaBrowser/issues/179
    $.ajaxSetup({
        cache: false
    });
}

$.support.cors = true;

$(document).one('click', WebNotifications.requestPermission);

var Dashboard = {
    jQueryMobileInit: function () {

        // Page
        //$.mobile.page.prototype.options.theme = "a";
        //$.mobile.page.prototype.options.headerTheme = "a";
        //$.mobile.page.prototype.options.contentTheme = "a";
        //$.mobile.page.prototype.options.footerTheme = "a";

        //$.mobile.button.prototype.options.theme = "c";
        $.mobile.listview.prototype.options.dividerTheme = "b";

        $.mobile.popup.prototype.options.theme = "c";
        //$.mobile.collapsible.prototype.options.contentTheme = "a";
    },

    getCurrentUser: function () {

        if (!Dashboard.getUserPromise) {
            Dashboard.getUserPromise = ApiClient.getUser(Dashboard.getCurrentUserId()).fail(Dashboard.logout);
        }

        return Dashboard.getUserPromise;
    },

    validateCurrentUser: function (page) {
        Dashboard.getUserPromise = null;

        if (Dashboard.getCurrentUserId()) {
            Dashboard.getCurrentUser();
        }

        page = page || $.mobile.activePage;

        var header = $('.header', page);

        if (header.length) {
            // Re-render the header
            header.remove();
            Dashboard.ensureHeader(page);
        }
    },

    getCurrentUserId: function () {

        var userId = localStorage.getItem("userId");

        if (!userId) {
            var autoLoginUserId = getParameterByName('u');

            if (autoLoginUserId) {
                userId = autoLoginUserId;
                localStorage.setItem("userId", userId);
            }
        }

        return userId;
    },

    setCurrentUser: function (userId) {
        localStorage.setItem("userId", userId);
        ApiClient.currentUserId(userId);
        Dashboard.getUserPromise = null;
    },

    logout: function () {
        localStorage.removeItem("userId");
        Dashboard.getUserPromise = null;
        ApiClient.currentUserId(null);
        window.location = "login.html";
    },

    showError: function (message) {

        $.mobile.loading('show', {
            theme: "e",
            text: message,
            textonly: true,
            textVisible: true
        });

        setTimeout(function () {
            $.mobile.loading('hide');
        }, 2000);
    },

    alert: function (message) {

        $.mobile.loading('show', {
            theme: "e",
            text: message,
            textonly: true,
            textVisible: true
        });

        setTimeout(function () {
            $.mobile.loading('hide');
        }, 2000);
    },

    updateSystemInfo: function (info) {

        var isFirstLoad = !Dashboard.lastSystemInfo;

        Dashboard.lastSystemInfo = info;
        Dashboard.ensureWebSocket(info);

        if (!Dashboard.initialServerVersion) {
            Dashboard.initialServerVersion = info.Version;
        }

        if (info.HasPendingRestart) {

            Dashboard.hideDashboardVersionWarning();
            Dashboard.showServerRestartWarning();

        } else {

            Dashboard.hideServerRestartWarning();

            if (Dashboard.initialServerVersion != info.Version) {

                Dashboard.showDashboardVersionWarning();
            }
        }

        if (isFirstLoad) {
            Dashboard.showFailedAssemblies(info.FailedPluginAssemblies);
        }

        Dashboard.showInProgressInstallations(info.InProgressInstallations);
    },

    showFailedAssemblies: function (failedAssemblies) {

        for (var i = 0, length = failedAssemblies.length; i < length; i++) {

            var assembly = failedAssemblies[i];

            var html = '<img src="css/images/notifications/error.png" class="notificationIcon" />';

            var index = assembly.lastIndexOf('\\');

            if (index != -1) {
                assembly = assembly.substring(index + 1);
            }

            html += '<span>';
            html += assembly + " failed to load.";
            html += '</span>';

            Dashboard.showFooterNotification({ html: html });

        }
    },

    showInProgressInstallations: function (installations) {

        installations = installations || [];

        for (var i = 0, length = installations.length; i < length; i++) {

            var installation = installations[i];

            var percent = installation.PercentComplete || 0;

            if (percent < 100) {
                Dashboard.showPackageInstallNotification(installation, "progress");
            }
        }

        if (installations.length) {

            Dashboard.ensureInstallRefreshInterval();
        } else {
            Dashboard.stopInstallRefreshInterval();
        }
    },

    ensureInstallRefreshInterval: function () {

        if (!Dashboard.installRefreshInterval) {

            if (ApiClient.isWebSocketOpen()) {
                ApiClient.sendWebSocketMessage("SystemInfoStart", "0,350");
            }
            Dashboard.installRefreshInterval = 1;
        }
    },

    stopInstallRefreshInterval: function () {

        if (Dashboard.installRefreshInterval) {
            if (ApiClient.isWebSocketOpen()) {
                ApiClient.sendWebSocketMessage("SystemInfoStop");
            }
            Dashboard.installRefreshInterval = null;
        }
    },

    cancelInstallation: function (id) {

        ApiClient.cancelPackageInstallation(id).always(Dashboard.refreshSystemInfoFromServer);

    },

    showServerRestartWarning: function () {

        var html = '<span style="margin-right: 1em;">Please restart Media Browser Server to finish updating.</span>';
        html += '<button type="button" data-icon="refresh" onclick="$(this).button(\'disable\');Dashboard.restartServer();" data-theme="b" data-inline="true" data-mini="true">Restart Server</button>';

        Dashboard.showFooterNotification({ id: "serverRestartWarning", html: html, forceShow: true, allowHide: false });
    },

    hideServerRestartWarning: function () {

        $('#serverRestartWarning').remove();
    },

    showDashboardVersionWarning: function () {

        var html = '<span style="margin-right: 1em;">Please refresh this page to receive new updates from the server.</span>';
        html += '<button type="button" data-icon="refresh" onclick="Dashboard.reloadPage();" data-theme="b" data-inline="true" data-mini="true">Refresh Page</button>';

        Dashboard.showFooterNotification({ id: "dashboardVersionWarning", html: html, forceShow: true, allowHide: false });
    },

    reloadPage: function () {

        window.location.href = window.location.href;
    },

    hideDashboardVersionWarning: function () {

        $('#dashboardVersionWarning').remove();
    },

    showFooterNotification: function (options) {

        var removeOnHide = !options.id;

        options.id = options.id || "notification" + new Date().getTime() + parseInt(Math.random());

        var parentElem = $('#footerNotifications');

        var elem = $('#' + options.id, parentElem);

        if (!elem.length) {
            elem = $('<p id="' + options.id + '" class="footerNotification"></p>').appendTo(parentElem);
        }

        var onclick = removeOnHide ? "$(\"#" + options.id + "\").remove();" : "$(\"#" + options.id + "\").hide();";

        if (options.allowHide !== false) {
            options.html += "<span style='margin-left: 1em;'><button type='button' onclick='" + onclick + "' data-icon='delete' data-iconpos='notext' data-mini='true' data-inline='true' data-theme='a'>Hide</button></span>";
        }

        if (options.forceShow) {
            elem.show();
        }

        elem.html(options.html).trigger('create');

        if (options.timeout) {

            setTimeout(function () {

                if (removeOnHide) {
                    elem.remove();
                } else {
                    elem.hide();
                }

            }, options.timeout);
        }
    },

    getConfigurationPageUrl: function (name) {
        return "ConfigurationPage?name=" + encodeURIComponent(name);
    },

    navigate: function (url, preserveQueryString) {

        var queryString = window.location.search;
        if (preserveQueryString && queryString) {
            url += queryString;
        }
        $.mobile.changePage(url);
    },

    showLoadingMsg: function () {
        $.mobile.loading("show");
    },

    hideLoadingMsg: function () {
        $.mobile.loading("hide");
    },

    processPluginConfigurationUpdateResult: function () {

        Dashboard.hideLoadingMsg();

        Dashboard.alert("Settings saved.");
    },

    defaultErrorMessage: "There was an error processing the request.",

    processServerConfigurationUpdateResult: function (result) {

        Dashboard.hideLoadingMsg();

        Dashboard.alert("Settings saved.");
    },

    confirm: function (message, title, callback) {

        $('#confirmFlyout').popup("close").remove();

        var html = '<div data-role="popup" id="confirmFlyout" style="max-width:500px;" class="ui-corner-all">';

        html += '<div class="ui-corner-top ui-bar-a" style="text-align:center;">';
        html += '<h3>' + title + '</h3>';
        html += '</div>';

        html += '<div data-role="content" class="ui-corner-bottom ui-content">';

        html += '<div style="padding: 1em .25em;margin: 0;">';
        html += message;
        html += '</div>';

        html += '<p><button type="button" data-icon="ok" onclick="$(\'#confirmFlyout\')[0].confirm=true;$(\'#confirmFlyout\').popup(\'close\');" data-theme="b">Ok</button></p>';
        html += '<p><button type="button" data-icon="delete" onclick="$(\'#confirmFlyout\').popup(\'close\');" data-theme="a">Cancel</button></p>';
        html += '</div>';

        html += '</div>';

        $(document.body).append(html);

        $('#confirmFlyout').popup({ history: false }).trigger('create').popup("open").on("popupafterclose", function () {

            if (callback) {
                callback(this.confirm == true);
            }

            $(this).off("popupafterclose").remove();
        });
    },

    refreshSystemInfoFromServer: function () {
        ApiClient.getSystemInfo().done(function (info) {

            Dashboard.updateSystemInfo(info);
        });
    },

    restartServer: function () {

        Dashboard.suppressAjaxErrors = true;
        Dashboard.showLoadingMsg();

        ApiClient.performPendingRestart().done(function () {

            setTimeout(function () {
                Dashboard.reloadPageWhenServerAvailable();
            }, 250);

        }).fail(function () {
            Dashboard.suppressAjaxErrors = false;
        });
    },

    reloadPageWhenServerAvailable: function (retryCount) {

        ApiClient.getSystemInfo().done(function (info) {

            // If this is back to false, the restart completed
            if (!info.HasPendingRestart) {
                Dashboard.reloadPage();
            } else {
                Dashboard.retryReload(retryCount);
            }

        }).fail(function () {
            Dashboard.retryReload(retryCount);
        });
    },

    retryReload: function (retryCount) {
        setTimeout(function () {

            retryCount = retryCount || 0;
            retryCount++;

            if (retryCount < 10) {
                Dashboard.reloadPageWhenServerAvailable(retryCount);
            } else {
                Dashboard.suppressAjaxErrors = false;
            }
        }, 500);
    },

    showUserFlyout: function (context) {

        Dashboard.getCurrentUser().done(function (user) {

            var html = '<div data-role="popup" id="userFlyout" style="max-width:400px;margin-top:30px;margin-right:20px;" class="ui-corner-all">';

            html += '<a href="#" data-rel="back" data-role="button" data-theme="a" data-icon="delete" data-iconpos="notext" class="ui-btn-right">Close</a>';

            html += '<div class="ui-corner-top ui-bar-a" style="text-align:center;">';
            html += '<h3>' + user.Name + '</h3>';
            html += '</div>';

            html += '<div data-role="content" class="ui-corner-bottom ui-content">';

            html += '<p style="text-align:center;">';

            var imageUrl = user.PrimaryImageTag ? ApiClient.getUserImageUrl(user.Id, {

                height: 400,
                tag: user.PrimaryImageTag,
                type: "Primary"

            }) : "css/images/userflyoutdefault.png";

            html += '<img style="max-height:125px;max-width:200px;" src="' + imageUrl + '" />';
            html += '</p>';

            html += '<p><button type="button" onclick="Dashboard.navigate(\'edituser.html?userId=' + user.Id + '\');" data-icon="user">View Profile</button></p>';
            html += '<p><button type="button" onclick="Dashboard.logout();" data-icon="lock">Sign Out</button></p>';
            html += '</div>';

            html += '</div>';

            $(document.body).append(html);

            $('#userFlyout').popup({ positionTo: context }).trigger('create').popup("open").on("popupafterclose", function () {

                $(this).off("popupafterclose").remove();
            });
        });
    },

    selectDirectory: function (options) {

        options = options || {};

        options.header = options.header || "Select Media Path";
        options.instruction = options.instruction || "Any path will do, but <b>network paths (UNC)</b> allow clients direct file playback when possible. For optimal playback of bluray and dvd folders, <b>network paths</b> are recommended.";

        var html = '<div data-role="popup" id="popupDirectoryPicker" class="ui-corner-all popup" style="min-width:65%;">';

        html += '<div class="ui-corner-top ui-bar-a" style="text-align: center; padding: 0 20px;">';
        html += '<h3>' + options.header + '</h3>';
        html += '</div>';

        html += '<div data-role="content" class="ui-corner-bottom ui-content">';
        html += '<form>';
        html += '<p class="directoryPickerHeadline">' + options.instruction + '</p>';

        html += '<div data-role="fieldcontain" style="margin:0;">';
        html += '<label for="txtDirectoryPickerPath" class="lblDirectoryPickerPath">Current Folder:</label>';
        html += '<input id="txtDirectoryPickerPath" name="txtDirectoryPickerPath" type="text" onchange="Dashboard.refreshDirectoryBrowser(this.value);" required="required" style="font-weight:bold;" />';
        html += '</div>';

        html += '<div style="height: 320px; overflow-y: auto;">';
        html += '<ul id="ulDirectoryPickerList" data-role="listview" data-inset="true" data-auto-enhanced="false"></ul>';
        html += '</div>';

        html += '<p>';
        html += '<button type="submit" data-theme="b" data-icon="ok">OK</button>';
        html += '<button type="button" data-icon="delete" onclick="$(this).parents(\'.popup\').popup(\'close\');">Cancel</button>';
        html += '</p>';
        html += '</form>';
        html += '</div>';
        html += '</div>';

        $($.mobile.activePage).append(html);

        var popup = $('#popupDirectoryPicker').popup().trigger('create').on("popupafteropen", function () {
            $('#popupDirectoryPicker input:first', this).focus();
        }).popup("open").on("popupafterclose", function () {

            $('form', this).off("submit");
            $(this).off("click").off("popupafterclose").remove();

        }).on("click", ".lnkDirectory", function () {

            var path = this.getAttribute('data-path');

            Dashboard.refreshDirectoryBrowser(path);
        });

        var txtCurrentPath = $('#txtDirectoryPickerPath', popup);

        if (options.path) {
            txtCurrentPath.val(options.path);
        }

        $('form', popup).on('submit', function () {

            if (options.callback) {
                options.callback($('#txtDirectoryPickerPath', this).val());
            }

            return false;
        });

        Dashboard.refreshDirectoryBrowser(txtCurrentPath.val());
    },

    refreshDirectoryBrowser: function (path) {
        var page = $.mobile.activePage;

        Dashboard.showLoadingMsg();

        var promise;

        if (path === "Network") {
            promise = ApiClient.getNetworkDevices();
        }
        else if (path) {
            promise = ApiClient.getDirectoryContents(path, { includeDirectories: true });
        } else {
            promise = ApiClient.getDrives();
        }

        promise.done(function (folders) {

            $('#txtDirectoryPickerPath', page).val(path || "");

            var html = '';

            if (path) {

                var parentPath = path;

                if (parentPath.endsWith('\\')) {
                    parentPath = parentPath.substring(0, parentPath.length - 1);
                }

                var lastIndex = parentPath.lastIndexOf('\\');
                parentPath = lastIndex == -1 ? "" : parentPath.substring(0, lastIndex);

                if (parentPath.endsWith(':')) {
                    parentPath += "\\";
                }

                if (parentPath == '\\') {
                    parentPath = "Network";
                }

                html += '<li><a class="lnkDirectory" data-path="' + parentPath + '" href="#">..</a></li>';
            }

            for (var i = 0, length = folders.length; i < length; i++) {

                var folder = folders[i];

                html += '<li><a class="lnkDirectory" data-path="' + folder.Path + '" href="#">' + folder.Name + '</a></li>';
            }

            if (!path) {
                html += '<li><a class="lnkDirectory" data-path="Network" href="#">Network</a></li>';
            }

            $('#ulDirectoryPickerList', page).html(html).listview('refresh');

            Dashboard.hideLoadingMsg();

        }).fail(function () {

            $('#txtDirectoryPickerPath', page).val("");
            $('#ulDirectoryPickerList', page).html('').listview('refresh');

            Dashboard.hideLoadingMsg();
        });
    },

    getPluginSecurityInfo: function () {

        if (!Dashboard.getPluginSecurityInfoPromise) {

            var deferred = $.Deferred();

            // Don't let this blow up the dashboard when it fails
            $.ajax({
                type: "GET",
                url: ApiClient.getUrl("Plugins/SecurityInfo"),
                dataType: 'json',

                error: function () {
                    // Don't show normal dashboard errors
                }

            }).done(function (result) {
                deferred.resolveWith(null, [[result]]);
            });

            Dashboard.getPluginSecurityInfoPromise = deferred;
        }

        return Dashboard.getPluginSecurityInfoPromise;
    },

    resetPluginSecurityInfo: function () {
        Dashboard.getPluginSecurityInfoPromise = null;
    },

    ensureHeader: function (page) {

        if (!page.hasClass('libraryPage') && !$('.headerButtons', page).length) {

            var isLoggedIn = Dashboard.getCurrentUserId();

            if (isLoggedIn) {

                Dashboard.getCurrentUser().done(function (user) {
                    Dashboard.renderHeader(page, user);
                });

            } else {

                Dashboard.renderHeader(page);
            }
        }
    },

    renderHeader: function (page, user) {

        var headerHtml = '';

        var header = $('.header', page);

        if (!header.length) {
            headerHtml += '<div class="header">';

            headerHtml += '<a class="logo" href="index.html">';

            if (page.hasClass('standalonePage')) {

                headerHtml += '<img class="imgLogoIcon" src="css/images/mblogoicon.png" /><img class="imgLogoText" src="css/images/mblogotextblack.png" />';
            }

            headerHtml += '</a>';
            headerHtml += '</div>';
            page.prepend(headerHtml);

            header = $('.header', page);
        }

        var imageColor = "black";

        headerHtml = '';
        headerHtml += '<div class="headerButtons">';

        if (user && !page.hasClass('wizardPage')) {

            headerHtml += '<a class="imageLink btnCurrentUser" href="#" onclick="Dashboard.showUserFlyout(this);"><span class="currentUsername">' + user.Name + '</span>';

            if (user.PrimaryImageTag) {

                var url = ApiClient.getUserImageUrl(user.Id, {
                    width: 225,
                    tag: user.PrimaryImageTag,
                    type: "Primary"
                });

                headerHtml += '<img src="' + url + '" />';
            } else {
                headerHtml += '<img src="css/images/currentuserdefault' + imageColor + '.png" />';
            }
            headerHtml += '</a>';

            if (user.Configuration.IsAdministrator) {
                headerHtml += '<a class="imageLink btnTools" href="dashboard.html"><img src="css/images/tools' + imageColor + '.png" /></a>';
            }

        }

        headerHtml += '</div>';

        header.append(headerHtml);

        if (!$('.supporterIcon', header).length) {
            
            Dashboard.getPluginSecurityInfo().done(function (pluginSecurityInfo) {

                if (pluginSecurityInfo.IsMBSupporter) {
                    $('<a class="imageLink supporterIcon" href="supporter.html" title="Thank you for supporting Media Browser."><img src="css/images/supporter/supporterbadge.png" /></a>').insertBefore($('.btnTools', header));
                } else {
                    $('<a class="imageLink supporterIcon" href="supporter.html" title="Become a Media Browser supporter!"><img src="css/images/supporter/nonsupporterbadge.png" /></a>').insertBefore($('.btnTools', header));
                }
            });
        }
    },

    ensureToolsMenu: function (page) {

        if (!page.hasClass('type-interior')) {
            return;
        }

        var sidebar = $('.toolsSidebar', page);

        if (!sidebar.length) {

            var html = '<div class="content-secondary ui-bar-a toolsSidebar">';

            html += '<h1><a href="index.html" class="imageLink" style="margin-left: 0;margin-right: 20px;"> <img src="css/images/mblogoicon.png" /></a>Tools</h1>';

            html += '<div class="sidebarLinks">';

            var links = Dashboard.getToolsMenuLinks(page);

            for (var i = 0, length = links.length; i < length; i++) {

                var link = links[i];

                if (link.href) {

                    if (link.selected) {
                        html += '<a class="selectedSidebarLink" href="' + link.href + '">' + link.name + '</a>';
                    } else {
                        html += '<a href="' + link.href + '">' + link.name + '</a>';
                    }

                }
            }

            // collapsible
            html += '</div>';

            // content-secondary
            html += '</div>';

            $(page).append(html);
        }
    },

    getToolsMenuLinks: function (page) {

        var pageElem = page[0];

        return [{
            name: "Dashboard",
            href: "dashboard.html",
            selected: pageElem.id == "dashboardPage"
        }, {
            name: "Default Media Library",
            href: "library.html",
            selected: pageElem.id == "mediaLibraryPage" && !getParameterByName('userId')
        }, {
            name: "Metadata",
            href: "metadata.html",
            selected: pageElem.id == "metadataConfigurationPage" || pageElem.id == "advancedMetadataConfigurationPage" || pageElem.id == "metadataImagesConfigurationPage"
        }, {
            name: "Plugins",
            href: "plugins.html",
            selected: page.hasClass("pluginConfigurationPage")
        }, {
            name: "User Profiles",
            href: "userprofiles.html",
            selected: page.hasClass("userProfilesConfigurationPage") || (pageElem.id == "mediaLibraryPage" && getParameterByName('userId'))
        }, {
            name: "Client Settings",
            href: "clientsettings.html",
            selected: pageElem.id == "clientSettingsPage"
        }, {
            name: "Advanced",
            href: "advanced.html",
            selected: pageElem.id == "advancedConfigurationPage"
        }, {
            name: "Scheduled Tasks",
            href: "scheduledtasks.html",
            selected: pageElem.id == "scheduledTasksPage" || pageElem.id == "scheduledTaskPage"
        }, {
            name: "Help",
            href: "support.html",
            selected: pageElem.id == "supportPage" || pageElem.id == "logPage" || pageElem.id == "supporterPage" || pageElem.id == "supporterKeyPage" || pageElem.id == "aboutPage"
        }];

    },

    ensureWebSocket: function (systemInfo) {

        if (!("WebSocket" in window)) {
            // Not supported by the browser
            return;
        }

        if (ApiClient.isWebSocketOpenOrConnecting()) {
            return;
        }

        systemInfo = systemInfo || Dashboard.lastSystemInfo;

        ApiClient.openWebSocket(systemInfo.WebSocketPortNumber);

        $(ApiClient).on("websocketmessage", Dashboard.onWebSocketMessageReceived);
    },

    onWebSocketMessageReceived: function (e, data) {

        var msg = data;

        if (msg.MessageType === "LibraryChanged") {
            Dashboard.processLibraryUpdateNotification(msg.Data);
        }
        else if (msg.MessageType === "UserDeleted") {
            Dashboard.validateCurrentUser();
        }
        else if (msg.MessageType === "SystemInfo") {
            Dashboard.updateSystemInfo(msg.Data);
        }
        else if (msg.MessageType === "RestartRequired") {
            Dashboard.updateSystemInfo(msg.Data);
        }
        else if (msg.MessageType === "UserUpdated") {
            Dashboard.validateCurrentUser();

            var user = msg.Data;

            if (user.Id == Dashboard.getCurrentUserId()) {

                $('.currentUsername').html(user.Name);
            }
        }
        else if (msg.MessageType === "PackageInstallationCompleted") {
            Dashboard.showPackageInstallNotification(msg.Data, "completed");
            Dashboard.refreshSystemInfoFromServer();
        }
        else if (msg.MessageType === "PackageInstallationFailed") {
            Dashboard.showPackageInstallNotification(msg.Data, "failed");
            Dashboard.refreshSystemInfoFromServer();
        }
        else if (msg.MessageType === "PackageInstallationCancelled") {
            Dashboard.showPackageInstallNotification(msg.Data, "cancelled");
            Dashboard.refreshSystemInfoFromServer();
        }
        else if (msg.MessageType === "PackageInstalling") {
            Dashboard.showPackageInstallNotification(msg.Data, "progress");
            Dashboard.refreshSystemInfoFromServer();
        }
        else if (msg.MessageType === "ScheduledTaskEnded") {

            Dashboard.showTaskCompletionNotification(msg.Data);
        }
        else if (msg.MessageType === "Browse") {

            Dashboard.onBrowseCommand(msg.Data);
        }
        else if (msg.MessageType === "Play") {



        }
        else if (msg.MessageType === "UpdatePlaystate") {

            // TODO for Craig
        }
    },

    onBrowseCommand: function (cmd) {

        var context = cmd.Context || "";

        var url;

        var type = cmd.ItemType.toLowerCase();

        if (type == "genre") {
            url = "itembynamedetails.html?genre=" + ApiClient.encodeName(cmd.ItemIdentifier) + "&context=" + context;
        }
        else if (type == "studio") {
            url = "itembynamedetails.html?studio=" + ApiClient.encodeName(cmd.ItemIdentifier) + "&context=" + context;
        }
        else if (type == "person") {
            url = "itembynamedetails.html?person=" + ApiClient.encodeName(cmd.ItemIdentifier) + "&context=" + context;
        }
        else if (type == "artist") {
            url = "itembynamedetails.html?artist=" + ApiClient.encodeName(cmd.ItemIdentifier) + "&context=" + (context || "music");
        }

        if (url) {
            Dashboard.navigate(url);
            return;
        }

        ApiClient.getItem(Dashboard.getCurrentUserId(), cmd.ItemIdentifier).done(function (item) {

            Dashboard.navigate(LibraryBrowser.getHref(item, context));

        });

    },

    showTaskCompletionNotification: function (result) {

        var html = '';

        if (result.Status == "Completed") {
            html += '<img src="css/images/notifications/done.png" class="notificationIcon" />';
            return;
        }
        else if (result.Status == "Cancelled") {
            html += '<img src="css/images/notifications/info.png" class="notificationIcon" />';
            return;
        }
        else {
            html += '<img src="css/images/notifications/error.png" class="notificationIcon" />';
        }

        html += '<span>';
        html += result.Name + " " + result.Status;
        html += '</span>';

        var timeout = 0;

        if (result.Status == 'Cancelled') {
            timeout = 2000;
        }

        Dashboard.showFooterNotification({ html: html, id: result.Id, forceShow: true, timeout: timeout });
    },

    showPackageInstallNotification: function (installation, status) {

        var html = '';

        if (status == 'completed') {
            html += '<img src="css/images/notifications/done.png" class="notificationIcon" />';
        }
        else if (status == 'cancelled') {
            html += '<img src="css/images/notifications/info.png" class="notificationIcon" />';
        }
        else if (status == 'failed') {
            html += '<img src="css/images/notifications/error.png" class="notificationIcon" />';
        }
        else if (status == 'progress') {
            html += '<img src="css/images/notifications/download.png" class="notificationIcon" />';
        }

        html += '<span style="margin-right: 1em;">';

        if (status == 'completed') {
            html += installation.Name + ' ' + installation.Version + ' installation completed';
        }
        else if (status == 'cancelled') {
            html += installation.Name + ' ' + installation.Version + ' installation was cancelled';
        }
        else if (status == 'failed') {
            html += installation.Name + ' ' + installation.Version + ' installation failed';
        }
        else if (status == 'progress') {
            html += 'Installing ' + installation.Name + ' ' + installation.Version;
        }

        html += '</span>';

        if (status == 'progress') {

            var percentComplete = Math.round(installation.PercentComplete || 0);

            html += '<progress style="margin-right: 1em;" max="100" value="' + percentComplete + '" title="' + percentComplete + '%">';
            html += '' + percentComplete + '%';
            html += '</progress>';

            if (percentComplete < 100) {
                var btnId = "btnCancel" + installation.Id;
                html += '<button id="' + btnId + '" type="button" data-icon="delete" onclick="$(\'' + btnId + '\').button(\'disable\');Dashboard.cancelInstallation(\'' + installation.Id + '\');" data-theme="b" data-inline="true" data-mini="true">Cancel</button>';
            }
        }

        var timeout = 0;

        if (status == 'cancelled') {
            timeout = 2000;
        }

        var forceShow = status != "progress";
        var allowHide = status != "progress" && status != 'cancelled';

        Dashboard.showFooterNotification({ html: html, id: installation.Id, timeout: timeout, forceShow: forceShow, allowHide: allowHide });
    },

    processLibraryUpdateNotification: function (data) {

        var newItems = data.ItemsAdded;

        if (!newItems.length) {
            return;
        }

        ApiClient.getItems(Dashboard.getCurrentUserId(), {

            Recursive: true,
            Limit: 3,
            Filters: "IsNotFolder",
            SortBy: "DateCreated",
            SortOrder: "Descending",
            ImageTypes: "Primary",
            Ids: newItems.join(',')

        }).done(function (result) {

            var items = result.Items;

            for (var i = 0, length = Math.min(items.length, 2) ; i < length; i++) {

                var item = items[i];

                var notification = {
                    title: "New " + item.Type,
                    body: item.Name,
                    timeout: 5000
                };

                var imageTags = item.ImageTags || {};

                if (imageTags.Primary) {

                    notification.icon = ApiClient.getImageUrl(item.Id, {
                        width: 100,
                        tag: imageTags.Primary,
                        type: "Primary"
                    });
                }

                WebNotifications.show(notification);
            }
        });
    },

    ensurePageTitle: function (page) {

        if (!page.hasClass('type-interior')) {
            return;
        }

        var pageElem = page[0];

        if (pageElem.hasPageTitle) {
            return;
        }

        var parent = $('.content-primary', page);

        if (!parent.length) {
            parent = $('.ui-content', page)[0];
        }

        $(parent).prepend("<h2 class='pageTitle'>" + (document.title || "&nbsp;") + "</h2>");

        pageElem.hasPageTitle = true;
    },

    setPageTitle: function (title) {

        $('.pageTitle', $.mobile.activePage).html(title);

        if (title) {
            document.title = title;
        }
    }


};

var ApiClient = MediaBrowser.ApiClient.create("Dashboard");

$(function () {

    var footerHtml = '<div id="footer" class="ui-bar-a">';
    footerHtml += '<div id="nowPlayingBar" style="display:none;">';
    footerHtml += '<a href="playlist.html"><img src="css/images/media/playlist.png" class="imageButton mediaButton" style="height:34px;margin-bottom:2px;vertical-align:bottom;" /></a>';
    footerHtml += '<button id="previousTrackButton" class="imageButton mediaButton" title="Previous Track" type="button"><img src="css/images/media/previoustrack.png" /></button>';
    footerHtml += '<button id="stopButton" class="imageButton mediaButton" title="Stop" type="button" onclick="MediaPlayer.stop();"><img src="css/images/media/stop.png" /></button>';
    footerHtml += '<button id="nextTrackButton" class="imageButton mediaButton" title="Next Track" type="button"><img src="css/images/media/nexttrack.png" /></button>';
    footerHtml += '<div id="mediaElement"></div>';
    footerHtml += '<div id="mediaInfo"></div>';
    footerHtml += '</div>';
    footerHtml += '<div id="footerNotifications"></div>';
    footerHtml += '</div>';

    $(document.body).append(footerHtml);

    if ($.browser.msie && parseInt($.browser.version) < 10) {

        alert("This is an unsupported version of Internet Explorer. Please consider upgrading to IE10, Chrome, or Firefox.");
    }
});

Dashboard.jQueryMobileInit();

$(document).on('pageinit', ".page", function () {

    var page = $(this);

    var userId = Dashboard.getCurrentUserId();
    ApiClient.currentUserId(userId);

    if (!userId) {

        if (this.id !== "loginPage" && !page.hasClass('wizardPage')) {

            Dashboard.logout();
        }
    }

    else {

        Dashboard.getCurrentUser().done(function (user) {

            if (user.Configuration.IsAdministrator) {
                Dashboard.ensureToolsMenu(page);
            }
        });
    }

}).on('pagebeforeshow', ".page", function () {

    Dashboard.refreshSystemInfoFromServer();

    var page = $(this);

    Dashboard.ensureHeader(page);
    Dashboard.ensurePageTitle(page);

});