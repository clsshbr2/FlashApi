const el = document.getElementById('userInfo');
let instacias = JSON.parse(el.dataset.instance);
const apikeyGlobal = el.dataset.apikey;
const apiurl = `${window.location.protocol}//${window.location.host}`

//Botão Conectar instacia
document.querySelectorAll('.btn-generate').forEach(button => {
    button.addEventListener('click', function () {
        const instanceId = this.dataset.id;
        const $btn = $(this);
        $btn.prop('disabled', true);
        $btn.find('.btn-text').text('Conectando...');
        $btn.find('.spinner-border').removeClass('d-none');
        generateQRCode(instanceId);
    });
});

//Botão Desconectar instacia
document.querySelectorAll('.btn-disconnect').forEach(button => {
    button.addEventListener('click', function () {
        const instanceId = this.dataset.id;
        const $btn = $(this);
        $btn.prop('disabled', true);
        $btn.find('.btn-text').text('Conectando...');
        $btn.find('.spinner-border').removeClass('d-none');
        if (confirm("Deseja realmente desconectar a instância?")) {
            disconnectInstance(instanceId);
        }
    });
});

//botão Deletar instacia
document.querySelectorAll('.btn-delete').forEach(button => {
    button.addEventListener('click', function () {
        const instanceId = this.dataset.id;
        if (confirm("Deseja realmente Deletar a instância?")) {
            const $btn = $(this);
            $btn.prop('disabled', true);
            $btn.find('.btn-text').text('Conectando...');
            $btn.find('.spinner-border').removeClass('d-none');
            deleteInstance(instanceId);
        }
    });
});

//botão atualizar qrcode
document.querySelectorAll('.btn-att-qrcode').forEach(button => {
    button.addEventListener('click', function () {
        const instanceId = this.dataset.id;
        $('#qr-code-info').html('');
        $('#qr-code-img').attr('src', '');
        $('#info-detalhes').html('')
        generateQRCode(instanceId);
    });
});

//botão condiguração
document.querySelectorAll('.btn-config').forEach(button => {
    button.addEventListener('click', function () {
        const instanceId = this.dataset.id;
        configuracao(instanceId);
    });
});


//Função gerar qrcode
async function generateQRCode(instanceId, modal = true) {
    const getapikey = instacias.find(i => i.id == instanceId);

    try {
        const headers = {
            'apikey': getapikey.apikey
        }

        const response = await axios.put(`${apiurl}/api/session/conectar_sessao`, null, {
            headers
        })
        if (response.data.success) {
            $('.btn-att-qrcode').attr('data-id', instanceId)
            $('#qr-code-info').html(`<strong>Codigo de conexão:</strong> ${response.data.code}`);
            $('#qr-code-img').attr('src', response.data.qrcode);
            $('#info-detalhes').html(`<strong>${response.data.message}</strong>`)
            // Abre o modal
            if (modal) {
                $('#modalQR').modal('show');
            }
        } else {
            if (response.data.message) {
                alert(response.data.message);
            } else {
                alert("QR Code não disponível.");
            }

        }
    } catch (error) {
        console.log(error)
        alert('Error ao gerar sessão tente novamente');
    } finally {

    }
}

//Funcão desconectar instacia
async function disconnectInstance(instanceId) {
    const getapikey = instacias.find(i => i.id == instanceId);
    try {
        const headers = {
            'apikey': getapikey.apikey
        }

        const response = await axios.delete(`${apiurl}/api/session/desconect/${getapikey.apikey}`, {
            headers
        })
        if (response.data.success) {
            alert(response.data.message);
        } else {
            if (response.data.message) {
                alert(response.data.message);
            } else {
                alert("Error ao desconectar instacia.");
            }
        }
        window.location.reload();

    } catch (error) {
        console.log(error)
        alert('Error ao gerar sessão tente novamente');
    }
}

//Funcão deletar instacia
async function deleteInstance(instanceId) {
    const getapikey = instacias.find(i => i.id == instanceId);
    try {
        const headers = {
            'apikey': apikeyGlobal
        }

        const response = await axios.delete(`${apiurl}/api/session/delete/${getapikey.apikey}`, {
            headers
        })
        if (response.data.success) {
            alert(response.data.message);
        } else {
            if (response.data.message) {
                alert(response.data.message);
            } else {
                alert("Error ao desconectar instacia.");
            }
        }
        window.location.reload();

    } catch (error) {
        console.log(error)
        alert('Error ao gerar sessão tente novamente');
    }
}

//Criar instacia
$('#form-Criar-Instance').on('submit', async (event) => {
    event.preventDefault();
    const nome_sessao = $('#nome-sessao').val();
    const apikey = $('#apikey-sessao').val();
    const numero = $('#numero-sessao').val();
    try {
        const headers = {
            'apikey': apikeyGlobal
        }

        const data = {
            nome_sessao,
            apikey,
            numero
        }
        const response = await axios.post(`${apiurl}/api/session/create_sessao`, data, {
            headers
        })
        if (response.data.success) {
            alert("Sessão criada com sucesso");
            window.location.reload();
        } else {
            if (response.data.message) {
                alert(response.data.message);
            } else {
                alert("Erro ao criar instacia.");
            }
        }

    } catch (error) {
        console.log(error)
        alert('Error ao gerar sessão tente novamente');
    } finally {
        window.location.reload();
    }
})

$('#modalQR').on('hidden.bs.modal', function () {
    window.location.reload();
});

$('#modalcreateSessao').on('hidden.bs.modal', function () {
    window.location.reload();
});

async function configuracao(instanceId) {
    const getapikey = instacias.find(i => i.id == instanceId);
    if (getapikey) {
        $('#id_sessao').attr('data-id', instanceId);
        $('#configSessao').modal('show')
        $('#webhook-url').val(getapikey.webhook_url)
        $('#webhook-status').prop('checked', getapikey.webhook_status == '1')
        $('[name="events[]"]').val(getapikey.events);

        $('#mensagem-rejeicao').val(getapikey.msg_rejectCalls)
        $('#rejeitar-chamada').prop('checked', getapikey.rejeitar_ligacoes == '1')

        $('#sempre-online').prop('checked', getapikey.leitura_automatica == '1')
        $('#ignorar-grupos').prop('checked', getapikey.ignorar_grupos == '1')

    }
}

//Alterar configurações
$('#form-config-Instance').on('submit', async function (e) {
    e.preventDefault();
    const instanceId = $('#id_sessao').attr('data-id')
    const getapikey = instacias.find(i => i.id == instanceId);
    if (!getapikey) {
        alert('Sessão não encontrada');
        window.location.reload();
    }
    const $btn = $(this).find('button[type="submit"]');
    $btn.prop('disabled', true);
    $btn.find('.btn-text').text('Salvando...');
    $btn.find('.spinner-border').removeClass('d-none');


    //Webhook
    const events = $('[name="events[]"]').val();
    const status_webhook = $('#webhook-status').prop('checked');
    const webhookUrl = $('#webhook-url').val();
    const dados = {
        events,
        status_webhook: status_webhook == true,
        webhookUrl
    }
    const headers = {
        'apikey': getapikey.apikey
    }
    await att_webhook(dados, headers)

    //Config geral
    const ignoreGroups = $('#ignorar-grupos').prop('checked');
    const autoRead = $('#sempre-online').prop('checked');
    const rejectCalls = $('#rejeitar-chamada').prop('checked');
    const msg_rejectCalls = $('#mensagem-rejeicao').val();

    const dados2 = {
        ignoreGroups: ignoreGroups == true,
        autoRead: autoRead == true,
        rejectCalls: rejectCalls == true,
        msg_rejectCalls
    }
    await att_config(dados2, headers)
    alert('Configurações atualizadas')
    window.location.reload();

    // Simule async request
    // setTimeout(() => {
    //     // Após salvar...
    //     $('#configSessao').modal('hide');
    //     $btn.prop('disabled', false);
    //     $btn.find('.btn-text').text('Salvar');
    //     $btn.find('.spinner-border').addClass('d-none');
    // }, 2000);
});


//Função para atualizar webhook
async function att_webhook(data, headers) {
    try {
        const response = await axios.put(`${apiurl}/api/config/webhook`, data, {
            headers
        })
    } catch (error) {

    }
}

//Função para atualizar configuração geral
async function att_config(data, headers) {
    try {
        const response = await axios.put(`${apiurl}/api/config/config`, data, {
            headers
        })
    } catch (error) {

    }
}

// Filtro por nome/apikey
document.getElementById('filtroBusca').addEventListener('input', function () {
    const termo = this.value.toLowerCase();
    const cards = document.querySelectorAll('.card-instance');

    cards.forEach(card => {
        const nome = card.dataset.nome.toLowerCase();
        const apikey = card.dataset.apikey.toLowerCase();

        if (nome.includes(termo) || apikey.includes(termo)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
});

// Copiar ao clicar
document.addEventListener('click', function (e) {
    if (e.target.classList.contains('copiar-btn')) {
        const valor = e.target.getAttribute('data-copy');
        navigator.clipboard.writeText(valor).then(() => {
            alert('Texto copiado com sucesso')
            e.target.textContent = '✅';
            setTimeout(() => {
                e.target.textContent = '📋';
            }, 1500);
        }).catch(err => {
            console.error('Erro ao copiar:', err);
        });
    }
});